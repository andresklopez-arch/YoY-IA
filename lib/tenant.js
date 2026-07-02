import { getActiveSalonId } from './firestore-tenant';

export const getClientDomain = () => {
  return process.env.NEXT_PUBLIC_CLIENT_DOMAIN || 'yoybillar.mx';
};

export const getAppName = () => {
  return process.env.NEXT_PUBLIC_APP_NAME || 'YoY IA Billar';
};

export const getAppSubtitle = () => {
  const salonId = getActiveSalonId();
  if (salonId === 'prueba_smart' || salonId === 'B;B-P3BUG-B') {
    return 'By Million Dollar';
  }
  return process.env.NEXT_PUBLIC_APP_SUBTITLE || 'By Alfonso Iturbide';
};

export const getAmbassadorName = () => {
  const salonId = getActiveSalonId();
  if (salonId === 'prueba_smart' || salonId === 'B;B-P3BUG-B') {
    return 'Million Dollar';
  }
  return 'Alfonso Iturbide';
};

export const getAppLogoPath = () => {
  const salonId = getActiveSalonId();
  if (salonId === 'prueba_smart' || salonId === 'B;B-P3BUG-B') {
    return '/logo_million_dollar.png';
  }
  return '/logo-corto.png';
};
