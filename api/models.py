from django.db import models

class MedicalQuery(models.Model):
    patient_name = models.CharField(max_length=100)
    symptoms = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Consulta de {self.patient_name}"