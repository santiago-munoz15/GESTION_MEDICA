from google import genai
from django.conf import settings

cliente = genai.Client(api_key=settings.GEMINI_API_KEY)
MODELO_GEMINI = getattr(settings, "GEMINI_MODEL", "gemini-flash-lite-latest")

# Admite ambos formatos: "gemini-flash-lite-latest" y "models/gemini-flash-lite-latest".
if MODELO_GEMINI.startswith("models/"):
    MODELO_GEMINI = MODELO_GEMINI.split("/", 1)[1]

def preguntar_gemini(prompt: str) -> str:
    respuesta = cliente.models.generate_content(
        model=MODELO_GEMINI,
        contents=prompt,
    )
    return respuesta.text or ""