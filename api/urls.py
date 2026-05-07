from django.urls import path
from .views import DiagnosticoIA

urlpatterns = [
    path("diagnostico/", DiagnosticoIA.as_view()),
]