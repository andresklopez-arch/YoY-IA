const SECRET_KEY = 'YoY-IA-Secret-Salt-2026';

const rc4 = (key, str) => {
  let s = [], j = 0, x, res = '';
  for (let i = 0; i < 256; i++) s[i] = i;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key.charCodeAt(i % key.length)) % 256;
    x = s[i]; s[i] = s[j]; s[j] = x;
  }
  let i = 0; j = 0;
  for (let y = 0; y < str.length; y++) {
    i = (i + 1) % 256;
    j = (j + s[i]) % 256;
    x = s[i]; s[i] = s[j]; s[j] = x;
    res += String.fromCharCode(str.charCodeAt(y) ^ s[(s[i] + s[j]) % 256]);
  }
  return res;
};

const safeBtoa = (str) => {
  if (typeof window !== 'undefined') {
    return window.btoa(str);
  }
  return Buffer.from(str, 'binary').toString('base64');
};

const safeAtob = (str) => {
  if (typeof window !== 'undefined') {
    return window.atob(str);
  }
  return Buffer.from(str, 'base64').toString('binary');
};

export const obfuscate = (data) => {
  if (!data) return '';
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  try {
    const encrypted = rc4(SECRET_KEY, str);
    return '[RC4]' + safeBtoa(unescape(encodeURIComponent(encrypted)));
  } catch (e) {
    console.error("Encryption error:", e);
  }
  return str;
};

export const deobfuscate = (str) => {
  if (!str) return null;
  
  // Try new RC4 method first
  try {
    if (str.startsWith('[RC4]')) {
      const encrypted = str.substring(5);
      const decodedBase64 = decodeURIComponent(escape(safeAtob(encrypted)));
      const decrypted = rc4(SECRET_KEY, decodedBase64);
      return JSON.parse(decrypted);
    }
  } catch (e) {
    console.warn("RC4 deobfuscation failed, trying old method:", e);
  }
  
  // Fallback to old XOR/Base64 method
  try {
    if (str.startsWith('[')) {
      const closingBracket1 = str.indexOf(']');
      if (closingBracket1 > 0) {
        const dateStr = str.substring(1, closingBracket1);
        const rest = str.substring(closingBracket1 + 1);
        if (rest.startsWith('[')) {
          const closingBracket2 = rest.indexOf(']');
          if (closingBracket2 > 0) {
            const signSaved = rest.substring(1, closingBracket2);
            const encryptedPart = rest.substring(closingBracket2 + 1);
            const xor = decodeURIComponent(escape(safeAtob(encryptedPart)));
            const base64 = xor.split('').map((char, index) => {
              const keyChar = dateStr.charCodeAt(index % dateStr.length);
              return String.fromCharCode(char.charCodeAt(0) ^ keyChar);
            }).join('');
            const decoded = decodeURIComponent(escape(safeAtob(base64)));
            return JSON.parse(decoded);
          }
        }
      }
    }
    const decoded = decodeURIComponent(escape(safeAtob(str)));
    return JSON.parse(decoded);
  } catch (e) {
    try {
      return JSON.parse(str);
    } catch (err) {
      return null;
    }
  }
};
