type ErrorAction = 'home' | 'retry' | 'sign-in';
type LocalizedText = [title: string, description: string];
type ErrorCopy = { en: LocalizedText; es: LocalizedText; action?: ErrorAction };

export const httpErrors: Readonly<Record<string, ErrorCopy>> = {
  400: {
    en: ['Invalid request', 'Check the address and try opening the page again.'],
    es: ['Solicitud no válida', 'Revisa la dirección e intenta abrir la página de nuevo.'],
  },
  401: {
    en: ['Sign in required', 'Sign in to continue to your account.'],
    es: ['Debes iniciar sesión', 'Inicia sesión para continuar a tu cuenta.'],
    action: 'sign-in',
  },
  403: {
    en: ['Access denied', 'Your account does not have permission to open this page.'],
    es: ['Acceso denegado', 'Tu cuenta no tiene permiso para abrir esta página.'],
  },
  404: {
    en: ['Page not found', 'The page may have moved or the address may be incorrect.'],
    es: ['Página no encontrada', 'Es posible que la página haya cambiado de lugar o que la dirección sea incorrecta.'],
  },
  405: {
    en: ['Action not allowed', 'This page does not accept that action. Open it from the site to continue.'],
    es: ['Acción no permitida', 'Esta página no admite esa acción. Ábrela desde el sitio para continuar.'],
  },
  408: {
    en: ['Request timed out', 'The request took too long. Try opening the page again.'],
    es: ['La solicitud tardó demasiado', 'Se agotó el tiempo de espera. Intenta abrir la página de nuevo.'],
    action: 'retry',
  },
  409: {
    en: [
      'Request conflicts with a change',
      'The information may have changed. Check the latest version before trying again.',
    ],
    es: [
      'Conflicto con un cambio',
      'Es posible que la información haya cambiado. Revisa la versión más reciente antes de intentarlo de nuevo.',
    ],
  },
  410: {
    en: ['Page removed', 'This page is no longer available.'],
    es: ['Página eliminada', 'Esta página ya no está disponible.'],
  },
  413: {
    en: ['Request too large', 'Reduce the size of what you are sending and try again.'],
    es: ['Solicitud demasiado grande', 'Reduce el tamaño de lo que envías e inténtalo de nuevo.'],
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
    en: ['Could not process the request', 'Review the information you entered and correct it before trying again.'],
    es: [
      'No pudimos procesar la solicitud',
      'Revisa los datos que ingresaste y corrígelos antes de intentarlo de nuevo.',
    ],
  },
  429: {
    en: ['Too many requests', 'Wait a moment before trying again.'],
    es: ['Demasiadas solicitudes', 'Espera un momento antes de intentarlo de nuevo.'],
    action: 'retry',
  },
  431: {
    en: ['Request headers too large', 'Try opening the page in a private window.'],
    es: ['Encabezados demasiado grandes', 'Intenta abrir la página en una ventana privada.'],
  },
  451: {
    en: ['Page unavailable', 'Access to this page is restricted for legal reasons.'],
    es: ['Página no disponible', 'El acceso a esta página está restringido por motivos legales.'],
  },
  500: {
    en: ['Something went wrong', 'We could not load this page. Try again in a moment.'],
    es: ['Algo salió mal', 'No pudimos cargar esta página. Inténtalo de nuevo en un momento.'],
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
      'No pudimos conectar con el servicio',
      'Un servicio del que dependemos no respondió como esperábamos. Inténtalo de nuevo en un momento.',
    ],
    action: 'retry',
  },
  503: {
    en: ['Service temporarily unavailable', 'This service is temporarily unavailable. Try again in a moment.'],
    es: [
      'Servicio temporalmente no disponible',
      'El servicio no está disponible por el momento. Inténtalo de nuevo en un momento.',
    ],
    action: 'retry',
  },
  504: {
    en: ['The service took too long to respond', 'Try again in a moment.'],
    es: ['El servicio tardó demasiado en responder', 'Inténtalo de nuevo en un momento.'],
    action: 'retry',
  },
  '4xx': {
    en: ['Could not open this page', 'Check the address or return to the home page.'],
    es: ['No pudimos abrir esta página', 'Revisa la dirección o vuelve a la página de inicio.'],
  },
  '5xx': {
    en: ['Could not load this page', 'The service ran into a problem. Try again in a moment.'],
    es: ['No pudimos cargar esta página', 'Ocurrió un problema con el servicio. Inténtalo de nuevo en un momento.'],
    action: 'retry',
  },
};
