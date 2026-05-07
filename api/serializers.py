from rest_framework import serializers
from .models import MedicalQuery

class MedicalQuerySerializer(serializers.ModelSerializer):
    class Meta:
        model = MedicalQuery
        fields = '__all__'