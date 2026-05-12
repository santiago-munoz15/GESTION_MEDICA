import json
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from django.conf import settings as django_settings
from django.core.mail import send_mail

from rest_framework.views import APIView
from rest_framework.response import Response
from google.genai import errors as genai_errors

from .services.gemini_client import preguntar_gemini
from .services.agente_medico import diagnosticar


def _intentar_parsear_json(texto: str):
    if not isinstance(texto, str):
        return None

    limpio = texto.strip()
    if limpio.startswith("```"):
        lineas = [linea for linea in limpio.splitlines() if not linea.strip().startswith("```")]
        limpio = "\n".join(lineas).strip()

    inicio = limpio.find("{")
    fin = limpio.rfind("}")
    if inicio != -1 and fin != -1 and fin > inicio:
        limpio = limpio[inicio:fin + 1]

    try:
        return json.loads(limpio)
    except json.JSONDecodeError:
        return None


def _especialista_por_gravedad(gravedad: str):
    gravedad_normalizada = (gravedad or "").strip().upper()
    if gravedad_normalizada == "ALTA":
        return "Urgencias"
    if gravedad_normalizada == "MEDIA":
        return "Medicina general"
    if gravedad_normalizada == "BAJA":
        return "Medicina general"
    return None


def _normalizar_respuesta_medica(respuesta):
    if not isinstance(respuesta, dict):
        return respuesta

    respuesta_normalizada = dict(respuesta)
    recomendaciones = respuesta_normalizada.get("recomendaciones")
    if isinstance(recomendaciones, str):
        respuesta_normalizada["recomendaciones"] = [recomendaciones]
    elif not isinstance(recomendaciones, list):
        respuesta_normalizada["recomendaciones"] = []

    medicamentos = respuesta_normalizada.get("medicamentos")
    if isinstance(medicamentos, str):
        respuesta_normalizada["medicamentos"] = [{"nombre": medicamentos}]
    elif not isinstance(medicamentos, list):
        respuesta_normalizada["medicamentos"] = []

    if not respuesta_normalizada.get("especialista"):
        respuesta_normalizada["especialista"] = _especialista_por_gravedad(
            respuesta_normalizada.get("gravedad")
        )

    return respuesta_normalizada


def _resumir_antecedentes_medicos(antecedentes_medicos):
    if not antecedentes_medicos:
        return "Ninguno reportado"

    if isinstance(antecedentes_medicos, str):
        return antecedentes_medicos.strip() or "Ninguno reportado"

    if isinstance(antecedentes_medicos, list):
        antecedentes_limpios = [str(antecedente).strip() for antecedente in antecedentes_medicos if str(antecedente).strip()]
        return ", ".join(antecedentes_limpios) if antecedentes_limpios else "Ninguno reportado"

    return str(antecedentes_medicos)

class DiagnosticoIA(APIView):
    def post(self, request):
        sintomas = request.data.get("sintomas", "")
        antecedentes_medicos = _resumir_antecedentes_medicos(request.data.get("antecedentes_medicos", []))
        gemini_timeout_seconds = int(getattr(django_settings, "GEMINI_TIMEOUT_SECONDS", 18) or 18)

        if len(sintomas.split()) < 3:
            return Response({
                "error": "La descripción es muy corta. Incluye más síntomas o detalles."
            }, status=400)

        prompt = f"""
Eres un médico general nivel 1. Analiza estos síntomas del paciente considerando sus antecedentes médicos.

Antecedentes médicos: {antecedentes_medicos}
Síntomas: {sintomas}

Responde EXCLUSIVAMENTE con un objeto JSON válido (sin markdown, sin bloques de código, sin texto extra) con:
- diagnostico
- gravedad (BAJA, MEDIA, ALTA)
- especialista
- recomendaciones (lista de recomendaciones generales)
- medicamentos (lista de objetos con: nombre, dosis, duracion)
- remision (si gravedad es ALTA)
"""

        def _enviar_correo_escalacion(respuesta_obj, datos_paciente):
            """Enviar correo a SPECIALIST_CONTACT_EMAIL y al email del especialista si viene en la respuesta.

            Retorna (enviado_bool, error_message_or_None, recipients_list)
            """
            if not isinstance(respuesta_obj, dict):
                return False, 'Respuesta no es JSON estructurado', []

            gravedad = (respuesta_obj.get('gravedad') or '').upper()
            if gravedad != 'ALTA':
                return False, 'No aplica (gravedad != ALTA)', []

            recipients = []
            # contacto general configurado en settings
            destino_general = getattr(django_settings, 'SPECIALIST_CONTACT_EMAIL', '')
            if destino_general:
                recipients.append(destino_general)

            # prioridad: email provisto por quien hace la solicitud (datos_paciente), luego campo 'especialista_email' en la respuesta, luego 'especialista' si contiene '@'
            especialista_email = None
            if isinstance(datos_paciente, dict):
                cand = datos_paciente.get('especialista_email') or datos_paciente.get('especialista')
                if isinstance(cand, str) and '@' in cand:
                    especialista_email = cand

            if not especialista_email and isinstance(respuesta_obj.get('especialista_email'), str) and '@' in respuesta_obj.get('especialista_email'):
                especialista_email = respuesta_obj.get('especialista_email')
            if not especialista_email:
                esp = respuesta_obj.get('especialista')
                if isinstance(esp, str) and '@' in esp:
                    especialista_email = esp

            if especialista_email and especialista_email not in recipients:
                recipients.append(especialista_email)

            if not recipients:
                return False, 'No hay destinatarios configurados para el correo de escalación', []

            subject = f"[ALERTA] Paciente con gravedad ALTA: {datos_paciente.get('nombre_completo', 'Paciente')}"
            recomendaciones = respuesta_obj.get('recomendaciones') or []
            recomendaciones_text = '\n'.join([f"- {r}" for r in recomendaciones]) if recomendaciones else 'No especificadas'

            body = (
                f"Se ha detectado un caso de gravedad ALTA en el sistema.\n\n"
                f"Paciente:\n"
                f"Nombre: {datos_paciente.get('nombre_completo', 'N/A')}\n"
                f"Tipo documento: {datos_paciente.get('tipo_documento', 'N/A')}\n"
                f"Número documento: {datos_paciente.get('numero_documento', 'N/A')}\n\n"
                f"Síntomas:\n{datos_paciente.get('sintomas','N/A')}\n\n"
                f"Diagnóstico:\n{respuesta_obj.get('diagnostico','N/A')}\n\n"
                f"Recomendaciones:\n{recomendaciones_text}\n\n"
                f"Especialista recomendado: {respuesta_obj.get('especialista','N/A')}\n\n"
                "Por favor coordinar cita y notificar al paciente."
            )

            def _send_sync():
                try:
                    print(f"[EMAIL] Enviando correo de escalacion a: {recipients}")
                    send_mail(subject, body, getattr(django_settings, 'DEFAULT_FROM_EMAIL', 'no-reply@localhost'), recipients, fail_silently=False)
                    print(f"[EMAIL] Enviado ok a: {recipients}")
                except Exception as e:
                    print(f"[EMAIL ERROR] {e}")

            # Enviar de forma asíncrona para no bloquear la respuesta HTTP ni agotar el worker
            try:
                thread = threading.Thread(target=_send_sync, daemon=True)
                thread.start()
                print(f"[EMAIL] Encolado correo de escalacion a: {recipients}")
                # No sabemos si llegará correctamente; devolvemos estado 'queued' en email_err para indicar encolado
                return None, 'queued', recipients
            except Exception as e:
                print(f"[EMAIL ERROR] no se pudo encolar: {e}", file=sys.stderr)
                return False, str(e), recipients

        try:
            # Evita que una llamada lenta a Gemini supere el timeout de Gunicorn.
            executor = ThreadPoolExecutor(max_workers=1)
            future = executor.submit(preguntar_gemini, prompt)
            try:
                respuesta_texto = future.result(timeout=gemini_timeout_seconds)
            except FuturesTimeoutError as timeout_exc:
                future.cancel()
                raise TimeoutError(
                    f"Gemini excedio el tiempo maximo de {gemini_timeout_seconds}s"
                ) from timeout_exc
            finally:
                executor.shutdown(wait=False, cancel_futures=True)

            respuesta = _intentar_parsear_json(respuesta_texto) or respuesta_texto
            respuesta = _normalizar_respuesta_medica(respuesta)

            # Intentar enviar correo si la gravedad es ALTA
            datos_paciente = {
                'nombre_completo': request.data.get('nombre_completo'),
                'tipo_documento': request.data.get('tipo_documento'),
                'numero_documento': request.data.get('numero_documento'),
                'sintomas': request.data.get('sintomas'),
                'especialista_email': request.data.get('especialista_email'),
            }
            email_sent, email_err, email_recipients = _enviar_correo_escalacion(respuesta, datos_paciente)

            respuesta_payload = {"respuesta": respuesta, "fuente": "gemini"}
            if email_sent is True:
                respuesta_payload['email_enviado'] = True
                respuesta_payload['email_recipients'] = email_recipients
            elif email_err == 'queued' or email_err == 'queued':
                respuesta_payload['email_enqueued'] = True
                respuesta_payload['email_recipients'] = email_recipients
            elif email_err:
                respuesta_payload['email_enviado'] = False
                respuesta_payload['email_error'] = email_err
                respuesta_payload['email_recipients'] = email_recipients if 'email_recipients' in locals() else []

            return Response(respuesta_payload)
        except TimeoutError as exc:
            print(f"[GEMINI TIMEOUT] {exc}", file=sys.stderr)
            respuesta_local = diagnosticar(sintomas)

            datos_paciente_local = {
                'nombre_completo': request.data.get('nombre_completo'),
                'tipo_documento': request.data.get('tipo_documento'),
                'numero_documento': request.data.get('numero_documento'),
                'sintomas': request.data.get('sintomas'),
                'especialista_email': request.data.get('especialista_email'),
            }

            try:
                email_sent, email_err, email_recipients = _enviar_correo_escalacion(respuesta_local, datos_paciente_local)
            except Exception:
                email_sent, email_err, email_recipients = False, 'Error al intentar enviar correo', []

            payload = {
                "fuente": "reglas_locales",
                "respuesta": respuesta_local,
                "warning": "Gemini tardo demasiado en responder. Se uso evaluacion local.",
                "error_razon": str(exc),
            }
            if email_sent is True:
                payload['email_enviado'] = True
                payload['email_recipients'] = email_recipients
            elif email_err == 'queued' or email_err == 'queued':
                payload['email_enqueued'] = True
                payload['email_recipients'] = email_recipients
            elif email_err:
                payload['email_enviado'] = False
                payload['email_error'] = email_err
                payload['email_recipients'] = email_recipients

            return Response(payload, status=200)
        except genai_errors.ClientError as exc:
            # Fallback local para evitar 500 cuando Gemini no tiene cuota o devuelve error de cliente.
            import sys
            print(f"[GEMINI ERROR] ClientError: {exc}", file=sys.stderr)
            respuesta_local = diagnosticar(sintomas)
            mensaje_error = str(exc)
            if getattr(exc, "status_code", None) == 429:
                return Response(
                    {
                        "fuente": "reglas_locales",
                        "respuesta": respuesta_local,
                        "warning": "Gemini no disponible por cuota (429). Se uso evaluacion local.",
                        "error_razon": "Cuota de Gemini excedida (429)",
                    },
                    status=200,
                )

            if getattr(exc, "status_code", None) == 403 and "reported as leaked" in mensaje_error:
                return Response(
                    {
                        "fuente": "reglas_locales",
                        "respuesta": respuesta_local,
                        "warning": "La API key de Gemini fue marcada como filtrada y bloqueada. Se uso evaluacion local.",
                        "error_razon": "API key de Gemini bloqueada por seguridad (403)",
                    },
                    status=200,
                )

            # intentar enviar correo de escalacion si corresponde
            datos_paciente_local = {
                'nombre_completo': request.data.get('nombre_completo'),
                'tipo_documento': request.data.get('tipo_documento'),
                'numero_documento': request.data.get('numero_documento'),
                'sintomas': request.data.get('sintomas'),
                'especialista_email': request.data.get('especialista_email'),
            }
            try:
                # reusar la misma rutina definida arriba para intentos de Gemini
                email_sent, email_err = False, None
                try:
                    email_sent, email_err, email_recipients = _enviar_correo_escalacion(respuesta_local, datos_paciente_local)
                except Exception:
                    email_sent, email_err, email_recipients = False, 'Error al intentar enviar correo', []
            except Exception:
                email_sent, email_err = False, 'Error inesperado al preparar email'

            payload = {
                "fuente": "reglas_locales",
                "respuesta": respuesta_local,
                "warning": "Gemini no disponible temporalmente. Se uso evaluacion local.",
                "error_razon": f"Error de Gemini: {str(exc)[:100]}",
            }
            if email_sent is True:
                payload['email_enviado'] = True
                payload['email_recipients'] = email_recipients
            elif email_err == 'queued' or email_err == 'queued':
                payload['email_enqueued'] = True
                payload['email_recipients'] = email_recipients
            elif email_err:
                payload['email_enviado'] = False
                payload['email_error'] = email_err
                payload['email_recipients'] = email_recipients

            return Response(payload, status=200)
        except Exception as e:
            import sys
            print(f"[GEMINI ERROR] Exception: {e}", file=sys.stderr)
            respuesta_local = diagnosticar(sintomas)
            return Response(
                {
                    "fuente": "reglas_locales",
                    "respuesta": respuesta_local,
                    "error_razon": f"Error inesperado: {str(e)[:100]}",
                },
                status=200,
            )