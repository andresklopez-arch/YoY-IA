import { NextResponse } from 'next/server';

export function middleware(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  // Interceptar rutas de la forma /mesa/:id
  const mesaMatch = path.match(/^\/mesa\/([^/]+)$/);
  if (mesaMatch) {
    const idParam = mesaMatch[1];
    // Si el identificador no es estrictamente numérico (ej. "NaN", "invalido", etc.)
    if (!/^\d+$/.test(idParam)) {
      // Permitir que la ruta /mesa/invalida pase libremente
      if (idParam === 'invalida') {
        return NextResponse.next();
      }
      // Redirigir identificadores inválidos a /mesa/invalida
      return NextResponse.redirect(new URL('/mesa/invalida', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/mesa/:path*'],
};
