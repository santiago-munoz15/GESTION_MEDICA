import { useState, useEffect } from 'react'
import { jsPDF } from 'jspdf'
import Swal from 'sweetalert2'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')
const DIAGNOSTICO_ENDPOINT = API_BASE_URL
  ? `${API_BASE_URL}/api/diagnostico/`
  : '/api/diagnostico/'

function intentarParsearRespuesta(raw) {
  if (raw && typeof raw === 'object') {
    return raw
  }

  if (typeof raw !== 'string') {
    return null
  }

  let limpio = raw.trim()
  if (limpio.startsWith('```')) {
    limpio = limpio
      .split('\n')
      .filter((linea) => !linea.trim().startsWith('```'))
      .join('\n')
      .trim()
  }

  const inicio = limpio.indexOf('{')
  const fin = limpio.lastIndexOf('}')
  if (inicio !== -1 && fin !== -1 && fin > inicio) {
    limpio = limpio.slice(inicio, fin + 1)
  }

  try {
    return JSON.parse(limpio)
  } catch {
    return null
  }
}

function contarPalabras(texto) {
  return texto.trim().split(/\s+/).filter(Boolean).length
}

function normalizarNombreCompleto(valor) {
  const soloLetrasYEspacios = valor.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s]/g, '')
  const espaciosNormalizados = soloLetrasYEspacios.replace(/\s+/g, ' ')
  return espaciosNormalizados.slice(0, 40)
}

async function cargarImagenComoDataUrl(ruta) {
  const respuesta = await fetch(ruta)
  if (!respuesta.ok) {
    throw new Error('No se pudo cargar la imagen')
  }

  const blob = await respuesta.blob()

  return await new Promise((resolve, reject) => {
    const lector = new FileReader()
    lector.onloadend = () => resolve(lector.result)
    lector.onerror = () => reject(new Error('No se pudo convertir la imagen'))
    lector.readAsDataURL(blob)
  })
}

async function parsearRespuestaHttp(response) {
  const contentType = response.headers.get('content-type') || ''
  const rawText = await response.text()

  let data = null
  if (rawText) {
    if (contentType.includes('application/json')) {
      try {
        data = JSON.parse(rawText)
      } catch {
        data = null
      }
    } else {
      data = intentarParsearRespuesta(rawText)
    }
  }

  if (!response.ok) {
    const errorDesdeApi = data && typeof data === 'object' ? data.error : null
    throw new Error(
      errorDesdeApi || `Error del servidor (${response.status}). Intenta nuevamente.`
    )
  }

  if (!data) {
    if (contentType.includes('text/html')) {
      throw new Error(
        'La API no respondio con JSON. Configura VITE_API_BASE_URL con la URL del backend en Render.'
      )
    }

    throw new Error('El servidor devolvio una respuesta vacia o invalida.')
  }

  return data
}

const ANTECEDENTES_MEDICOS = [
  { label: 'Asma', value: 'asma' },
  { label: 'Neumonía', value: 'neumonia' },
  { label: 'Bronquitis', value: 'bronquitis' },
  { label: 'Hipertensión arterial', value: 'hipertension_arterial' },
  { label: 'Insuficiencia cardiaca', value: 'insuficiencia_cardiaca' },
  { label: 'Enfermedad coronaria (angina)', value: 'enfermedad_coronaria_angina' },
  { label: 'Diabetes mellitus tipo 2', value: 'diabetes_mellitus_tipo_2' },
  { label: 'Hipotiroidismo', value: 'hipotiroidismo' },
  { label: 'Dislipidemia (colesterol alto)', value: 'dislipidemia_colesterol_alto' },
  { label: 'Migraña', value: 'migrana' },
  { label: 'Epilepsia', value: 'epilepsia' },
  { label: 'Accidente cerebrovascular (ACV)', value: 'accidente_cerebrovascular_acv' },
  { label: 'Infección urinaria (ITU)', value: 'infeccion_urinaria_itu' },
  { label: 'Gastroenteritis', value: 'gastroenteritis' },
  { label: 'Dengue', value: 'dengue' },
  { label: 'Lumbalgia', value: 'lumbalgia' },
  { label: 'Artrosis', value: 'artrosis' },
  { label: 'Tendinitis', value: 'tendinitis' },
  { label: 'Depresión', value: 'depresion' },
  { label: 'Ansiedad', value: 'ansiedad' },
  { label: 'Trastorno bipolar', value: 'trastorno_bipolar' },
  { label: 'Gastritis', value: 'gastritis' },
  { label: 'Reflujo gastroesofágico (ERGE)', value: 'reflujo_gastroesofagico_erge' },
  { label: 'Colon irritable', value: 'colon_irritable' },
  { label: 'Enfermedad renal crónica', value: 'enfermedad_renal_cronica' },
  { label: 'Hígado graso', value: 'higado_graso' },
  { label: 'Cáncer (general)', value: 'cancer_general' },
  { label: 'Otitis', value: 'otitis' },
  { label: 'Bronquiolitis', value: 'bronquiolitis' },
  { label: 'Amigdalitis', value: 'amigdalitis' },
  { label: 'Alergias', value: 'alergias' },
  { label: 'Ninguno', value: 'ninguno' },
]

function App() {
  const [tipoDocumento, setTipoDocumento] = useState('')
  const [numeroDocumento, setNumeroDocumento] = useState('')
  const [nombreCompleto, setNombreCompleto] = useState('')
  const [genero, setGenero] = useState('')
  const [edad, setEdad] = useState('')
  const [antecedentesMedicos, setAntecedentesMedicos] = useState([])
  const [sintomas, setSintomas] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [intentoEnvio, setIntentoEnvio] = useState(false)
  const [paginaActiva, setPaginaActiva] = useState('formulario')
  const [resultado, setResultado] = useState(null)
  const [datosConsulta, setDatosConsulta] = useState(null)
  const [logoDataUrl, setLogoDataUrl] = useState('')
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('darkMode') === 'true'
    }
    return false
  })

  useEffect(() => {
    const htmlElement = document.documentElement
    const rootElement = document.getElementById('root')

    if (darkMode) {
      htmlElement.classList.add('dark')
      rootElement?.classList.add('dark')
    } else {
      htmlElement.classList.remove('dark')
      rootElement?.classList.remove('dark')
    }

    localStorage.setItem('darkMode', darkMode)
  }, [darkMode])

  useEffect(() => {
    let activo = true

    cargarImagenComoDataUrl('/img/logo.png')
      .then((dataUrl) => {
        if (activo) {
          setLogoDataUrl(dataUrl)
        }
      })
      .catch(() => {
        if (activo) {
          setLogoDataUrl('')
        }
      })

    return () => {
      activo = false
    }
  }, [])

  const numeroDocumentoValido = /^\d{1,10}$/.test(numeroDocumento)
  const nombreCompletoValido = nombreCompleto.trim().length >= 1 && nombreCompleto.trim().length <= 40
  const edadValida = /^\d{1,2}$/.test(edad)
  const palabrasActuales = contarPalabras(sintomas)
  const sintomasValido = palabrasActuales >= 10

  const obtenerErroresFormulario = () => {
    const errores = []

    if (!tipoDocumento) {
      errores.push('tipo de documento')
    }

    if (!numeroDocumento) {
      errores.push('número de documento')
    } else if (!numeroDocumentoValido) {
      errores.push('número de documento válido de hasta 10 dígitos')
    }

    if (!nombreCompleto) {
      errores.push('nombre completo')
    } else if (!nombreCompletoValido) {
      errores.push('nombre completo válido de hasta 40 caracteres')
    }

    if (!genero) {
      errores.push('género')
    }

    if (!edad) {
      errores.push('edad')
    } else if (!edadValida) {
      errores.push('edad válida de dos dígitos')
    }

    if (!sintomas) {
      errores.push('síntomas del paciente')
    } else if (!sintomasValido) {
      errores.push('síntomas con al menos 10 palabras')
    }

    return errores
  }

  const limpiarConsulta = () => {
    setTipoDocumento('')
    setNumeroDocumento('')
    setNombreCompleto('')
    setGenero('')
    setEdad('')
    setAntecedentesMedicos([])
    setSintomas('')
    setError('')
    setIntentoEnvio(false)
    setPaginaActiva('formulario')
    setResultado(null)
    setDatosConsulta(null)
    setLoading(false)
  }

  const enviarDiagnostico = async (event) => {
    event.preventDefault()
    if (loading) {
      return
    }

    setIntentoEnvio(true)
    const erroresFormulario = obtenerErroresFormulario()
    if (erroresFormulario.length > 0) {
      setError(`Completa o corrige: ${erroresFormulario.join(', ')}.`)
      return
    }

    setLoading(true)
    setError('')

    const marcaTiempo = new Date()

    try {
      const response = await fetch(DIAGNOSTICO_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tipo_documento: tipoDocumento,
          numero_documento: numeroDocumento,
          nombre_completo: nombreCompleto,
          genero,
          edad,
          antecedentes_medicos: antecedentesMedicos,
          sintomas,
        }),
      })

      const data = await parsearRespuestaHttp(response)

      setResultado(data)
      setDatosConsulta({
        tipoDocumento,
        numeroDocumento,
        nombreCompleto,
        genero,
        edad,
        antecedentesMedicos,
        fechaHora: marcaTiempo.toLocaleString('es-CO'),
      })
      setPaginaActiva('resultado')

      // Mostrar alerta cuando se genera el diagnóstico
      Swal.fire({
        title: 'Diagnóstico Generado',
        text: 'El análisis de los síntomas ha sido completado exitosamente.',
        icon: 'success',
        confirmButtonText: 'Aceptar',
        confirmButtonColor: '#0891b2',
        didOpen: () => {
          // Cerrar automáticamente después de 4 segundos
          setTimeout(() => {
            Swal.close()
          }, 4000)
        }
      })
    } catch (requestError) {
      setError(requestError.message || 'Error inesperado al consultar el servicio.')
      setResultado(null)
      setDatosConsulta(null)
    } finally {
      setLoading(false)
    }
  }

  const respuesta = resultado?.respuesta
  const respuestaParseada = intentarParsearRespuesta(respuesta)
  const isRespuestaObjeto = Boolean(respuestaParseada)
  const recomendaciones = Array.isArray(respuestaParseada?.recomendaciones)
    ? respuestaParseada.recomendaciones
    : typeof respuestaParseada?.recomendaciones === 'string'
      ? [respuestaParseada.recomendaciones]
      : []
  const medicamentos = Array.isArray(respuestaParseada?.medicamentos)
    ? respuestaParseada.medicamentos
    : []
  const errorTipoDocumento = intentoEnvio && !tipoDocumento ? 'Selecciona un tipo de documento.' : ''
  const errorNumeroDocumento = intentoEnvio
    ? !numeroDocumento
      ? 'Ingresa el número de documento.'
      : !numeroDocumentoValido
        ? 'Solo números y máximo 10 dígitos.'
        : ''
    : ''
  const errorNombreCompleto = intentoEnvio
    ? !nombreCompleto
      ? 'Ingresa el nombre completo.'
      : !nombreCompletoValido
        ? 'Solo letras y máximo 40 caracteres.'
        : ''
    : ''
  const errorGenero = intentoEnvio && !genero ? 'Selecciona un género.' : ''
  const errorEdad = intentoEnvio
    ? !edad
      ? 'Ingresa la edad.'
      : !edadValida
        ? 'La edad debe tener máximo dos dígitos.'
        : ''
    : ''
  const errorSintomas = intentoEnvio
    ? !sintomas
      ? 'Describe los síntomas del paciente.'
      : !sintomasValido
        ? 'Debes escribir al menos 10 palabras.'
        : ''
    : ''

  const alternarAntecedente = (valor) => {
    setAntecedentesMedicos((actuales) => {
      if (valor === 'ninguno') {
        return actuales.includes('ninguno') ? [] : ['ninguno']
      }

      const sinNinguno = actuales.filter((item) => item !== 'ninguno')
      if (sinNinguno.includes(valor)) {
        return sinNinguno.filter((item) => item !== valor)
      }

      return [...sinNinguno, valor]
    })
  }

  const formatearAntecedentes = (antecedentes = []) => {
    if (typeof antecedentes === 'string') {
      return antecedentes || 'Ninguno reportado'
    }

    if (!Array.isArray(antecedentes) || antecedentes.length === 0) {
      return 'Ninguno reportado'
    }

    return antecedentes
      .map((valor) => ANTECEDENTES_MEDICOS.find((item) => item.value === valor)?.label || valor)
      .join(', ')
  }

  const antecedentesResumen = formatearAntecedentes(datosConsulta?.antecedentesMedicos ?? antecedentesMedicos)

  const volverAEvaluacionInicial = () => {
    setPaginaActiva('formulario')
  }

  const guardarPdf = async () => {
    if (!resultado) {
      return
    }

    const doc = new jsPDF({ unit: 'pt', format: 'a4' })
    const margenX = 40
    const anchoTexto = 515
    let y = 46
    const logoPdf = logoDataUrl || (await cargarImagenComoDataUrl('/img/logo.png').catch(() => ''))

    if (logoPdf) {
      doc.addImage(logoPdf, 'PNG', margenX, 24, 34, 34)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(16)
      doc.text('Reporte Consulta Medica IA', 84, 40)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.setTextColor(71, 85, 105)
      doc.text('Asistente médico', 84, 54)
      doc.setDrawColor(203, 213, 225)
      doc.setLineWidth(0.8)
      doc.line(margenX, 66, 555, 66)
      doc.setTextColor(0, 0, 0)
      y = 88
    } else {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(15)
      doc.text('Reporte Consulta Medica IA', margenX, y)
      y += 24
    }

    const escribirBloque = (texto, salto = 18) => {
      const lineas = doc.splitTextToSize(String(texto), anchoTexto)
      doc.text(lineas, margenX, y)
      y += lineas.length * 14 + salto
    }
    const antecedentesPdf = formatearAntecedentes(datosConsulta?.antecedentesMedicos)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    escribirBloque(`Fecha y hora: ${datosConsulta?.fechaHora || new Date().toLocaleString('es-CO')}`, 10)
    escribirBloque(`Paciente: ${datosConsulta?.nombreCompleto || 'No disponible'}`, 8)
    escribirBloque(
      `Documento: ${datosConsulta?.tipoDocumento || 'N/A'} ${datosConsulta?.numeroDocumento || 'N/A'}`,
      14,
    )
    escribirBloque(`Genero: ${datosConsulta?.genero || 'No disponible'}`, 8)
    escribirBloque(`Edad: ${datosConsulta?.edad || 'No disponible'}`, 14)
    escribirBloque(`Antecedentes medicos: ${antecedentesPdf}`, 14)
    escribirBloque(`Sintomas reportados: ${sintomas || 'No disponible'}`, 14)

    if (resultado.warning) {
      doc.setFont('helvetica', 'bold')
      escribirBloque('Advertencia del sistema:', 4)
      doc.setFont('helvetica', 'normal')
      escribirBloque(resultado.warning, 14)
    }

    doc.setFont('helvetica', 'bold')
    escribirBloque('Resultado medico:', 4)
    doc.setFont('helvetica', 'normal')

    if (isRespuestaObjeto) {
      escribirBloque(`Diagnostico: ${respuestaParseada.diagnostico || 'N/A'}`, 8)
      escribirBloque(`Gravedad: ${respuestaParseada.gravedad || 'N/A'}`, 8)
      escribirBloque(`Especialista: ${respuestaParseada.especialista || 'N/A'}`, 10)

      const recomendaciones = respuestaParseada.recomendaciones || []
      if (recomendaciones.length > 0) {
        doc.setFont('helvetica', 'bold')
        escribirBloque('Recomendaciones:', 2)
        doc.setFont('helvetica', 'normal')
        recomendaciones.forEach((item, index) => {
          escribirBloque(`${index + 1}. ${item}`, 2)
        })
      }

      const medicamentos = respuestaParseada.medicamentos || []
      if (medicamentos.length > 0) {
        doc.setFont('helvetica', 'bold')
        escribirBloque('Medicamentos recomendados:', 2)
        doc.setFont('helvetica', 'normal')
        medicamentos.forEach((med, index) => {
          const dosis = med.dosis ? ` - Dosis: ${med.dosis}` : ''
          const duracion = med.duracion ? ` - Duración: ${med.duracion}` : ''
          escribirBloque(`${index + 1}. ${med.nombre}${dosis}${duracion}`, 2)
        })
      }
    } else {
      escribirBloque(String(respuesta || 'Sin contenido'))
    }

    const nombreArchivo = `reporte_${(datosConsulta?.numeroDocumento || 'paciente').replace(/\s+/g, '_')}.pdf`
    doc.save(nombreArchivo)
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6 bg-white dark:bg-slate-950 transition-colors sm:px-8 sm:py-10">
      <header className="mb-6 rounded-3xl border border-slate-200/70 dark:border-slate-700/70 bg-white/80 dark:bg-slate-900/80 p-6 shadow-[0_12px_40px_rgba(16,36,61,0.08)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.3)] backdrop-blur sm:p-8">
        <button
          onClick={() => setDarkMode(!darkMode)}
          className="absolute right-4 top-6 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 p-2 text-slate-700 dark:text-slate-200 transition hover:bg-slate-200 dark:hover:bg-slate-700 sm:right-8"
          aria-label="Cambiar modo"
          title={darkMode ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
        >
          {darkMode ? '☀️' : '🌙'}
        </button>
        <div className="flex flex-col gap-4 pr-12 sm:flex-row sm:items-center sm:gap-5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-50 via-white to-emerald-50 shadow-lg ring-1 ring-slate-200 dark:from-cyan-900/30 dark:via-slate-900 dark:to-emerald-900/20 dark:ring-slate-700 sm:h-20 sm:w-20 sm:self-start sm:mt-1">
            <img
              src="/img/logo.png"
              alt="Logo del aplicativo"
              className="h-10 w-10 object-contain sm:h-12 sm:w-12"
            />
          </div>
          <div>
            <p className="mono mb-2 inline-block rounded-full bg-amber-100 dark:bg-amber-900/30 px-3 py-1 text-xs font-medium text-amber-900 dark:text-amber-200">
              ASISTENTE MEDICO
            </p>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-5xl">
              {paginaActiva === 'formulario' ? 'Evaluacion inicial de sintomas' : 'Resultado de la evaluacion'}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-300 sm:text-base">
              {paginaActiva === 'formulario'
                ? 'Describe tus síntomas con el mayor detalle posible. El sistema utilizará un método de análisis avanzado y, si no es posible procesar la información por completo, aplicará una evaluación alternativa para garantizar que siempre recibas una orientación inicial.'
                : 'Aquí puedes revisar el resultado generado, descargar el PDF y volver al formulario para realizar una nueva evaluación.'}
            </p>
          </div>
        </div>
      </header>

      {paginaActiva === 'formulario' ? (
        <section>
          <form
            onSubmit={enviarDiagnostico}
            className="rounded-3xl border border-slate-200/70 dark:border-slate-700/70 bg-white/90 dark:bg-slate-900/90 p-5 shadow-[0_10px_30px_rgba(16,36,61,0.08)] dark:shadow-[0_10px_30px_rgba(0,0,0,0.3)] sm:p-6"
          >
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300">
                  Tipo de documento
                </span>
                <select
                  value={tipoDocumento}
                  onChange={(event) => setTipoDocumento(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-white outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-200 dark:focus:ring-cyan-900"
                  required
                >
                  <option value="" disabled>
                    Seleccione tipo documento
                  </option>
                  <option value="Cedula">Cedula</option>
                  <option value="TI">TI</option>
                  <option value="Registro civil">Registro civil</option>
                </select>
                {errorTipoDocumento ? <span className="mt-1 block text-xs text-rose-500">{errorTipoDocumento}</span> : null}
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300">
                  Numero de documento
                </span>
                <input
                  type="text"
                  value={numeroDocumento}
                  onChange={(event) => setNumeroDocumento(event.target.value.replace(/\D/g, '').slice(0, 10))}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-white outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-200 dark:focus:ring-cyan-900"
                  placeholder="Ej: 1032456789"
                  maxLength={10}
                  inputMode="numeric"
                  required
                />
                <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">Solo números, máximo 10 dígitos.</span>
                {errorNumeroDocumento ? <span className="mt-1 block text-xs text-rose-500">{errorNumeroDocumento}</span> : null}
              </label>
            </div>

            <label className="mb-4 block">
              <span className="mb-2 block text-sm font-semibold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300">
                Nombre completo
              </span>
              <input
                type="text"
                value={nombreCompleto}
                onChange={(event) => setNombreCompleto(normalizarNombreCompleto(event.target.value))}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-white outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-200 dark:focus:ring-cyan-900"
                placeholder="Ej: Maria Fernanda Perez"
                maxLength={40}
                required
              />
              <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">Solo letras y espacios, máximo 40 caracteres.</span>
              {errorNombreCompleto ? <span className="mt-1 block text-xs text-rose-500">{errorNombreCompleto}</span> : null}
            </label>

            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300">
                  Genero
                </span>
                <select
                  value={genero}
                  onChange={(event) => setGenero(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-white outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-200 dark:focus:ring-cyan-900"
                  required
                >
                  <option value="" disabled>
                    Seleccione genero
                  </option>
                  <option value="Masculino">Masculino</option>
                  <option value="Femenino">Femenino</option>
                </select>
                {errorGenero ? <span className="mt-1 block text-xs text-rose-500">{errorGenero}</span> : null}
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300">
                  Edad
                </span>
                <input
                  type="text"
                  value={edad}
                  onChange={(event) => setEdad(event.target.value.replace(/\D/g, '').slice(0, 2))}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-white outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-200 dark:focus:ring-cyan-900"
                  placeholder="Ej: 32"
                  maxLength={2}
                  inputMode="numeric"
                  required
                />
                <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">Ingresa una edad de dos dígitos como máximo.</span>
                {errorEdad ? <span className="mt-1 block text-xs text-rose-500">{errorEdad}</span> : null}
              </label>
            </div>

            <fieldset className="mb-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4">
              <legend className="px-1 text-sm font-semibold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300">
                Antecedentes medicos
              </legend>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {ANTECEDENTES_MEDICOS.map((antecedente) => (
                  <label
                    key={antecedente.value}
                    className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-700 dark:text-slate-200"
                  >
                    <input
                      type="checkbox"
                      checked={antecedentesMedicos.includes(antecedente.value)}
                      onChange={() => alternarAntecedente(antecedente.value)}
                      className="h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                    />
                    <span>{antecedente.label}</span>
                  </label>
                ))}
              </div>
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                Selecciona uno o varios antecedentes. Si no aplica, marca “Ninguno”.
              </p>
            </fieldset>

            <label htmlFor="sintomas" className="mb-3 block text-sm font-semibold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300">
              Sintomas del paciente
            </label>
            <textarea
              id="sintomas"
              value={sintomas}
              onChange={(event) => {
                // Filter out special characters, keep letters, numbers, spaces, and common punctuation
                const filtered = event.target.value.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ\s,.\-?!]/g, '');
                setSintomas(filtered.slice(0, 250));
              }}
              placeholder="Ej: fiebre alta, tos seca, dolor de garganta y fatiga desde hace 3 dias"
              className="min-h-52 w-full resize-y rounded-2xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 p-4 text-sm leading-relaxed text-slate-800 dark:text-white outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-200 dark:focus:ring-cyan-900"
              maxLength={250}
              required
            />
            <span className="mt-1 block text-xs transition" style={{
              color: sintomas.length >= 225 ? '#f87171' : '#10b981'
            }}>
              {sintomas.length}/250 caracteres
            </span>
            {errorSintomas ? <span className="mt-1 block text-xs text-rose-500">{errorSintomas}</span> : null}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={loading}
                className="mono rounded-xl bg-cyan-700 dark:bg-cyan-800 px-5 py-3 text-sm font-semibold text-white transition hover:bg-cyan-800 dark:hover:bg-cyan-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? 'Analizando...' : 'Obtener evaluacion'}
              </button>
              <button
                type="button"
                onClick={limpiarConsulta}
                className="mono rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-5 py-3 text-sm font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                Limpiar todo
              </button>
              <span className="text-xs text-slate-500 dark:text-slate-400">Tiempo estimado: 2 a 8 segundos</span>
            </div>

            {loading ? (
              <p className="mt-3 rounded-xl border border-cyan-200 dark:border-cyan-900 bg-cyan-50 dark:bg-cyan-900/30 px-3 py-2 text-sm text-cyan-900 dark:text-cyan-200">
                Analizando sintomas, por favor espera...
              </p>
            ) : null}

            {error ? (
              <p className="mt-4 rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-900/30 px-3 py-2 text-sm text-rose-700 dark:text-rose-200">{error}</p>
            ) : null}
          </form>
        </section>
      ) : (
        <section>
          <article className="rounded-3xl border border-slate-200/70 dark:border-slate-700/70 bg-white/90 dark:bg-slate-900/90 p-5 shadow-[0_10px_30px_rgba(16,36,61,0.08)] dark:shadow-[0_10px_30px_rgba(0,0,0,0.3)] sm:p-6">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Resultado</h2>

            {!resultado ? (
              <p className="mt-6 rounded-2xl border border-dashed border-slate-300 dark:border-slate-600 p-4 text-sm text-slate-500 dark:text-slate-400">
                No hay un resultado disponible. Regresa a la evaluación inicial para generar uno nuevo.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {datosConsulta ? (
                  <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-sm text-slate-700 dark:text-slate-300">
                    <p>
                      <strong>Paciente:</strong> {datosConsulta.nombreCompleto}
                    </p>
                    <p>
                      <strong>Documento:</strong> {datosConsulta.tipoDocumento} {datosConsulta.numeroDocumento}
                    </p>
                    <p>
                      <strong>Genero:</strong> {datosConsulta.genero}
                    </p>
                    <p>
                      <strong>Edad:</strong> {datosConsulta.edad}
                    </p>
                    <p>
                      <strong>Antecedentes medicos:</strong> {antecedentesResumen}
                    </p>
                    <p>
                      <strong>Fecha y hora:</strong> {datosConsulta.fechaHora}
                    </p>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={guardarPdf}
                    className="mono rounded-xl border border-cyan-300 dark:border-cyan-900 bg-cyan-50 dark:bg-cyan-900/30 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-cyan-900 dark:text-cyan-200 transition hover:bg-cyan-100 dark:hover:bg-cyan-900/50"
                  >
                    Guardar PDF
                  </button>
                  <button
                    type="button"
                    onClick={volverAEvaluacionInicial}
                    className="mono rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200 transition hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    Volver a evaluacion inicial
                  </button>
                </div>

                {resultado.warning ? (
                  <p className="rounded-xl border border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-900/30 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
                    {resultado.warning}
                  </p>
                ) : null}

                {isRespuestaObjeto ? (
                  <div className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
                    <p>
                      <strong>Diagnostico:</strong> {respuestaParseada.diagnostico || 'N/A'}
                    </p>
                    <p>
                      <strong>Gravedad:</strong> {respuestaParseada.gravedad || 'N/A'}
                    </p>
                    <p>
                      <strong>Especialista:</strong> {respuestaParseada.especialista || 'N/A'}
                    </p>
                    <div>
                      <strong>Recomendaciones:</strong>
                      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                        {recomendaciones.map((item) => (
                          <li
                            key={item}
                            className="rounded-xl border border-cyan-100 dark:border-cyan-900 bg-cyan-50/60 dark:bg-cyan-900/30 p-3 text-sm leading-relaxed"
                          >
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                    {medicamentos.length > 0 && (
                      <div>
                        <strong>Medicamentos Recomendados:</strong>
                        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                          {medicamentos.map((med, idx) => (
                            <li
                              key={idx}
                              className="rounded-xl border border-emerald-100 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-900/30 p-3 text-sm leading-relaxed"
                            >
                              <div className="font-semibold text-emerald-900 dark:text-emerald-100">{med.nombre}</div>
                              {med.dosis && <div className="mt-1 text-emerald-800 dark:text-emerald-200">Dosis: {med.dosis}</div>}
                              {med.duracion && <div className="text-emerald-800 dark:text-emerald-200">Duración: {med.duracion}</div>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  <pre className="mono overflow-x-auto rounded-2xl bg-slate-900 dark:bg-slate-950 p-4 text-xs text-slate-100 dark:text-slate-200 sm:text-sm">
                    {String(respuesta || '')}
                  </pre>
                )}
              </div>
            )}
          </article>
        </section>
      )}

      <footer className="mt-6 rounded-3xl border border-slate-200/70 dark:border-slate-700/70 bg-white/80 dark:bg-slate-900/80 px-5 py-4 text-xs text-slate-500 dark:text-slate-400 sm:px-6">
        Esta interfaz es de apoyo informativo y no reemplaza evaluacion medica profesional.
      </footer>
    </main>
  )
}

export default App
