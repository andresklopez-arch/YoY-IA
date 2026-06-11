export const getClientDomain = () => {
  return process.env.NEXT_PUBLIC_CLIENT_DOMAIN || 'yoybillar.mx';
};

export const getAppName = () => {
  return process.env.NEXT_PUBLIC_APP_NAME || 'YoY IA Billar';
};

export const getAppSubtitle = () => {
  return process.env.NEXT_PUBLIC_APP_SUBTITLE || 'By Alfonso Iturbide';
};
