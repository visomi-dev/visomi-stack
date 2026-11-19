type ErrorAction = 'home' | 'retry' | 'sign-in';
type LocalizedText = [title: string, description: string];
type ErrorCopy = { en: LocalizedText; es: LocalizedText; action?: ErrorAction };

export const httpErrors: Readonly<Record<string, ErrorCopy>> = {
  400: {
    en: ['Invalid request', 'Check the web address and try again.'],
    es: ['Solicitud incorrecta', 'Revisa la dirección web e intenta de nuevo.'],
  },
  401: {
    en: ['Sign in required', 'Sign in to continue to your account.'],
    es: ['Debes iniciar sesión', 'Inicia sesión para entrar a tu cuenta.'],
    action: 'sign-in',
  },
  403: {
    en: ['Access denied', 'Your account does not have permission to open this page.'],
    es: ['Acceso denegado', 'Tu cuenta no tiene permiso para abrir esta página.'],
  },
  404: {
    en: ['Page not found', 'The page may have moved or the address may be incorrect.'],
    es: ['Página no encontrada', 'Tal vez cambió la dirección de la página. Revisa el enlace.'],
  },
  405: {
    en: ['Action not allowed', 'This page does not accept that action. Open it from the site to continue.'],
    es: ['Acción no permitida', 'Esta página no admite esa acción. Ábrela desde el sitio para continuar.'],
  },
  408: {
    en: ['Request timed out', 'The page took too long to load. Try again.'],
    es: ['La solicitud tardó demasiado', 'La página tardó demasiado en cargar. Intenta de nuevo.'],
    action: 'retry',
  },
  409: {
    en: [
      'Information may have changed',
      'The information may have changed. Check the latest version before trying again.',
    ],
    es: ['Los datos pudieron cambiar', 'Revisa la versión más reciente e intenta de nuevo.'],
  },
  410: {
    en: ['Page removed', 'This page is no longer available.'],
    es: ['Página eliminada', 'Esta página ya no está disponible.'],
  },
  413: {
    en: ['Request too large', 'Send less data and try again.'],
    es: ['Solicitud demasiado grande', 'Reduce la cantidad de datos que envías e intenta de nuevo.'],
  },
  414: {
    en: ['Address too long', 'Open the page from the site or use a shorter link.'],
    es: ['Dirección demasiado larga', 'Abre la página desde el sitio o usa un enlace más corto.'],
  },
  415: {
    en: ['Unsupported format', 'Check the accepted formats before trying again.'],
    es: ['Formato no admitido', 'Revisa los formatos aceptados antes de intentarlo de nuevo.'],
  },
  422: {
    en: ['Could not process the request', 'Check the information you entered. Correct any errors and try again.'],
    es: ['No pudimos procesar la solicitud', 'Revisa lo que escribiste. Corrige los errores e intenta de nuevo.'],
  },
  429: {
    en: ['Too many requests', 'Wait a moment, then try again.'],
    es: ['Demasiadas solicitudes', 'Espera un momento e intenta de nuevo.'],
    action: 'retry',
  },
  431: {
    en: ['Your browser sent too much information', 'Try opening the page in a private window.'],
    es: ['Tu navegador envió demasiados datos', 'Intenta abrir la página en una ventana privada.'],
  },
  451: {
    en: ['Page unavailable', 'Access to this page is restricted for legal reasons.'],
    es: ['Página no disponible', 'El acceso a esta página está restringido por motivos legales.'],
  },
  500: {
    en: ['Something went wrong', 'We could not load this page. Try again in a moment.'],
    es: ['Algo salió mal', 'No pudimos cargar esta página. Intenta de nuevo en un momento.'],
    action: 'retry',
  },
  501: {
    en: ['Action unavailable', 'This service does not support the requested action.'],
    es: ['Acción no disponible', 'Este servicio no admite la acción solicitada.'],
  },
  502: {
    en: [
      'Could not connect to the service',
      'A service we depend on did not respond as expected. Try again in a moment.',
    ],
    es: [
      'No pudimos conectarnos con el servicio',
      'No recibimos la respuesta que necesitábamos. Intenta de nuevo en un momento.',
    ],
    action: 'retry',
  },
  503: {
    en: ['Service temporarily unavailable', 'This service is temporarily unavailable. Try again in a moment.'],
    es: ['Servicio temporalmente no disponible', 'Intenta de nuevo en un momento.'],
    action: 'retry',
  },
  504: {
    en: ['The service took too long to respond', 'Try again in a moment.'],
    es: ['El servicio tardó demasiado en responder', 'Intenta de nuevo en un momento.'],
    action: 'retry',
  },
  '4xx': {
    en: ['Could not open this page', 'Check the address or return to the home page.'],
    es: ['No pudimos abrir esta página', 'Revisa la dirección o vuelve a la página de inicio.'],
  },
  '5xx': {
    en: ['Could not load this page', 'The service ran into a problem. Try again in a moment.'],
    es: ['No pudimos cargar esta página', 'Ocurrió un problema con el servicio. Intenta de nuevo en un momento.'],
    action: 'retry',
  },
};
