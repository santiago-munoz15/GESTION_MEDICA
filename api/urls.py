from django.urls import path
from .views import DiagnosticoIA, EnviarCorreoEscalacion

urlpatterns = [
    path("diagnostico/", DiagnosticoIA.as_view()),
    path("enviar-correo-escalacion/", EnviarCorreoEscalacion.as_view()),
]