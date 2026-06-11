export default function Loading() {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh', background:'var(--bg-base)' }}>
      <div style={{ textAlign:'center', padding: '24px' }}>
        <img 
          src="/logo-largo.png" 
          alt="YoY IA Billar By Alfonso Iturbide" 
          style={{ 
            width: 260, 
            height: 'auto', 
            objectFit: 'contain',
            animation: 'pulse 1.6s infinite ease-in-out', 
            margin: '0 auto 24px',
            display: 'block',
            filter: 'drop-shadow(0 0 15px rgba(205,127,50,0.2))'
          }} 
        />
        <p style={{ color:'var(--text-secondary)', fontSize: 10, letterSpacing:'0.2em', textTransform:'uppercase', fontWeight: 600 }}>Iniciando sistema...</p>
      </div>
    </div>
  );
}
