import { getActiveSalonId } from './firestore-tenant';

export const getClientDomain = () => {
  return process.env.NEXT_PUBLIC_CLIENT_DOMAIN || 'yoybillar.mx';
};

export const getAppName = () => {
  return process.env.NEXT_PUBLIC_APP_NAME || 'YoY IA Billar';
};

export const getAppSubtitle = () => {
  const salonId = (getActiveSalonId() || '').toLowerCase();
  if (salonId.includes('million') || salonId.includes('prueba_smart') || salonId.includes('p3bug')) {
    return 'By Million Dollar';
  }
  return process.env.NEXT_PUBLIC_APP_SUBTITLE || 'By Alfonso Iturbide';
};

export const getAmbassadorName = () => {
  const salonId = (getActiveSalonId() || '').toLowerCase();
  if (salonId.includes('million') || salonId.includes('prueba_smart') || salonId.includes('p3bug')) {
    return 'Million Dollar';
  }
  return 'Alfonso Iturbide';
};

export const getAppLogoPath = () => {
  const salonId = (getActiveSalonId() || '').toLowerCase();
  if (salonId.includes('million') || salonId.includes('prueba_smart') || salonId.includes('p3bug')) {
    return '/logo_million_dollar.png';
  }
  return '/logo-corto.png';
};
