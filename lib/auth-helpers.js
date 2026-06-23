export const isMasterUser = (email) => {
  if (!email) return false;
  const lower = email.toLowerCase().trim();
  return lower === 'masteradmin@yoybillar.mx' || lower.startsWith('masteradmin@');
};
