import time
import sys
from google import genai
from google.genai import errors as genai_errors
from django.conf import settings

cliente = genai.Client(api_key=settings.GEMINI_API_KEY)
MODELO_GEMINI = getattr(settings, "GEMINI_MODEL", "gemini-flash-lite-latest")

# Admite ambos formatos: "gemini-flash-lite-latest" y "models/gemini-flash-lite-latest".
if MODELO_GEMINI.startswith("models/"):
    MODELO_GEMINI = MODELO_GEMINI.split("/", 1)[1]

def preguntar_gemini(prompt: str) -> str:
    """Llamar Gemini con reintentos automáticos en caso de 503 UNAVAILABLE."""
    max_intentos = 3
    espera_inicial = 2  # segundos

    for intento in range(1, max_intentos + 1):
        try:
            respuesta = cliente.models.generate_content(
                model=MODELO_GEMINI,
                contents=prompt,
            )
            return respuesta.text or ""
        except genai_errors.ClientError as exc:
            codigo_estado = getattr(exc, "status_code", None)
            # Reintenta si es 503 (sobrecarga temporal)
            if codigo_estado == 503 and intento < max_intentos:
                espera = espera_inicial * (2 ** (intento - 1))  # backoff exponencial
                print(f"[GEMINI RETRY] Intento {intento}/{max_intentos} falló con 503. Esperando {espera}s antes de reintentar...", file=sys.stderr)
                time.sleep(espera)
                continue
            # Para otros errores, propagar inmediatamente
            raise
        except Exception as exc:
            # Error inesperado, no reintentar
            raise

    # Si llegamos aquí (no debería pasar), lanzar error
    raise Exception("Se agotaron todos los intentos de Gemini")