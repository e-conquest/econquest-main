{{- define "econquest.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "econquest.fullname" -}}
{{- if contains .Chart.Name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "econquest.labels" -}}
app.kubernetes.io/name: {{ include "econquest.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "econquest.selectorLabels" -}}
app.kubernetes.io/name: {{ include "econquest.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "econquest.secretName" -}}
{{- if .Values.secret.existingSecret -}}
{{- .Values.secret.existingSecret -}}
{{- else -}}
{{- include "econquest.fullname" . -}}
{{- end -}}
{{- end -}}

{{- define "econquest.allowedHosts" -}}
{{- $hosts := .Values.allowedHosts -}}
{{- if .Values.ingress.enabled -}}
{{- $hosts = append $hosts .Values.ingress.host -}}
{{- end -}}
{{- $hosts | uniq | join "," -}}
{{- end -}}
