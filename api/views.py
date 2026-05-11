import json

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

        try:
            respuesta_texto = preguntar_gemini(prompt)
            respuesta = _intentar_parsear_json(respuesta_texto) or respuesta_texto
            respuesta = _normalizar_respuesta_medica(respuesta)
            return Response({"respuesta": respuesta, "fuente": "gemini"})
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

            return Response(
                {
                    "fuente": "reglas_locales",
                    "respuesta": respuesta_local,
                    "warning": "Gemini no disponible temporalmente. Se uso evaluacion local.",
                    "error_razon": f"Error de Gemini: {str(exc)[:100]}",
                },
                status=200,
            )
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