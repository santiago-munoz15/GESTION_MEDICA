def diagnosticar(sintomas: str) -> dict:
    s = sintomas.lower()

    # 🔴 EMERGENCIAS
    if "dolor en el pecho" in s or "dificultad para respirar" in s:
        return {
            "diagnostico": "Posible evento cardíaco o problema respiratorio grave.",
            "recomendaciones": [
                "Acudir a urgencias inmediatamente",
                "Evitar actividad física",
                "Mantenerse acompañado"
            ],
            "gravedad": "ALTA",
            "especialista": "Cardiología / Neumología"
        }

    # 🟠 INFECCIÓN RESPIRATORIA
    if "fiebre" in s and "tos" in s:
        return {
            "diagnostico": "Posible infección respiratoria o gripe.",
            "recomendaciones": [
                "Reposo",
                "Hidratación constante",
                "Acetaminofén para la fiebre",
                "Uso de tapabocas"
            ],
            "gravedad": "MEDIA",
            "especialista": None
        }

    # 🟡 GASTROENTERITIS
    if "diarrea" in s or "vomito" in s:
        return {
            "diagnostico": "Posible gastroenteritis.",
            "recomendaciones": [
                "Consumir suero oral",
                "Evitar alimentos grasos",
                "Reposo",
                "Monitorear deshidratación"
            ],
            "gravedad": "MEDIA",
            "especialista": "Gastroenterología"
        }

    # 🟢 ALERGIA
    if "estornudos" in s or "picazon" in s:
        return {
            "diagnostico": "Posible reacción alérgica.",
            "recomendaciones": [
                "Evitar el alérgeno",
                "Uso de antihistamínicos",
                "Mantener espacios ventilados"
            ],
            "gravedad": "BAJA",
            "especialista": "Alergología"
        }

    # 🔵 ESTRÉS / ANSIEDAD
    if "ansiedad" in s or "estres" in s or "no puedo dormir" in s:
        return {
            "diagnostico": "Posible cuadro de estrés o ansiedad.",
            "recomendaciones": [
                "Ejercicios de respiración",
                "Reducir carga laboral",
                "Dormir adecuadamente",
                "Evitar cafeína"
            ],
            "gravedad": "BAJA",
            "especialista": "Psicología"
        }

    # ⚪ CASO GENERAL (OBLIGATORIO)
    return {
        "diagnostico": "Síntomas generales no específicos.",
        "recomendaciones": [
            "Descanso",
            "Hidratación",
            "Observar evolución",
            "Consultar médico si empeora"
        ],
        "gravedad": "MEDIA",
        "especialista": None
    }