import { NextResponse } from 'next/server';

// Algoritmo de comparación inteligente para conciliar transacciones
function reconcileTransactions(yoyTxList, bankTxList) {
  const matches = [];
  const unmatchedYoy = [];
  const unmatchedBank = [...bankTxList.map((t, idx) => ({ ...t, index: idx }))];
  
  // Clonamos y limpiamos las transacciones de YoY para la comparación
  const yoyPool = yoyTxList.map(t => {
    // Intentar formatear la fecha a YYYY-MM-DD
    let formattedDate = '';
    try {
      if (t.fecha) {
        formattedDate = new Date(t.fecha).toISOString().split('T')[0];
      }
    } catch (e) {
      formattedDate = t.fecha || '';
    }

    return {
      ...t,
      cleanMonto: Math.abs(Number(t.monto) || 0),
      cleanDate: formattedDate,
      isExpense: t.tipo === 'gasto' || t.tipo === 'nomina'
    };
  });

  // Primero pasamos para encontrar coincidencias exactas (monto exacto y fecha exacta)
  for (let i = yoyPool.length - 1; i >= 0; i--) {
    const yoy = yoyPool[i];
    
    // Buscar en el banco un movimiento del mismo monto, misma fecha y misma dirección (abono/cargo)
    const matchIdx = unmatchedBank.findIndex(bank => {
      const bankIsExpense = bank.monto < 0;
      const bankMontoAbs = Math.abs(bank.monto);
      
      const sameMonto = Math.abs(bankMontoAbs - yoy.cleanMonto) < 0.01;
      const sameDate = bank.fecha === yoy.cleanDate;
      const sameDirection = bankIsExpense === yoy.isExpense;

      return sameMonto && sameDate && sameDirection;
    });

    if (matchIdx !== -1) {
      const bank = unmatchedBank.splice(matchIdx, 1)[0];
      matches.push({ yoy, bank });
      yoyPool.splice(i, 1);
    }
  }

  // Segunda pasada para coincidencias aproximadas en fecha (mismo monto, fecha con ventana de ±3 días)
  for (let i = yoyPool.length - 1; i >= 0; i--) {
    const yoy = yoyPool[i];
    
    const matchIdx = unmatchedBank.findIndex(bank => {
      const bankIsExpense = bank.monto < 0;
      const bankMontoAbs = Math.abs(bank.monto);
      
      const sameMonto = Math.abs(bankMontoAbs - yoy.cleanMonto) < 0.01;
      const sameDirection = bankIsExpense === yoy.isExpense;
      
      let dateDiffDays = 999;
      try {
        if (bank.fecha && yoy.cleanDate) {
          const dBank = new Date(bank.fecha);
          const dYoy = new Date(yoy.cleanDate);
          const diffTime = Math.abs(dBank - dYoy);
          dateDiffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        }
      } catch (e) {
        // Ignorar error de parsing
      }

      return sameMonto && sameDirection && dateDiffDays <= 3;
    });

    if (matchIdx !== -1) {
      const bank = unmatchedBank.splice(matchIdx, 1)[0];
      matches.push({ yoy, bank, approximateDate: true });
      yoyPool.splice(i, 1);
    }
  }

  // Lo que queda son discrepancias
  unmatchedYoy.push(...yoyPool);

  return {
    matches,
    unmatchedYoy,
    unmatchedBank: unmatchedBank.map(({ index, ...rest }) => rest) // Limpiar índice temporal
  };
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { fileData, fileType, yoyTransactions } = body;

    if (!fileData || !fileType) {
      return NextResponse.json({ error: "Faltan los datos o tipo de archivo a analizar." }, { status: 400 });
    }

    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      return NextResponse.json({
        error: "Falta configurar la variable GEMINI_API_KEY en .env.local para habilitar la conciliación con IA."
      }, { status: 500 });
    }

    // Preparar el payload para la API de Gemini
    const geminiPayload = {
      contents: [
        {
          parts: [
            {
              text: "Extract all financial transactions from this bank statement or ticket image/PDF. Return ONLY a valid JSON array of objects. Do not wrap it in ```json codeblocks or any additional text. If there are no transactions, return an empty array [].\n\nEach object must represent a transaction and have exactly this structure:\n{\n  \"fecha\": \"YYYY-MM-DD\",\n  \"monto\": number (positive for deposits/income/SPEI received/credits, negative for charges/withdrawals/debits/expenses),\n  \"descripcion\": \"string (short description/concept of the transaction)\"\n}"
            },
            {
              inlineData: {
                mimeType: fileType,
                data: fileData
              }
            }
          ]
        }
      ]
    };

    // Llamada a Gemini 2.5 Flash
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(geminiPayload)
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Error respuesta de Gemini API:", errText);
      return NextResponse.json({ error: `La API de Gemini retornó un error: ${response.statusText}` }, { status: 502 });
    }

    const resJson = await response.json();
    
    // Validar respuesta estructurada
    if (!resJson.candidates || !resJson.candidates[0] || !resJson.candidates[0].content || !resJson.candidates[0].content.parts || !resJson.candidates[0].content.parts[0]) {
      return NextResponse.json({ error: "Gemini no devolvió una respuesta válida. Intenta de nuevo." }, { status: 500 });
    }

    const rawText = resJson.candidates[0].content.parts[0].text;
    
    // Limpieza de formato markdown de la respuesta de Gemini si está presente
    let cleanText = rawText.trim();
    if (cleanText.startsWith('```json')) {
      cleanText = cleanText.substring(7);
    } else if (cleanText.startsWith('```')) {
      cleanText = cleanText.substring(3);
    }
    if (cleanText.endsWith('```')) {
      cleanText = cleanText.substring(0, cleanText.length - 3);
    }
    cleanText = cleanText.trim();

    let bankTransactions = [];
    try {
      bankTransactions = JSON.parse(cleanText);
      if (!Array.isArray(bankTransactions)) {
        bankTransactions = [];
      }
    } catch (parseErr) {
      console.error("Error al parsear JSON devuelto por Gemini:", cleanText, parseErr);
      return NextResponse.json({ 
        error: "No se pudo interpretar el formato de los datos extraídos por la IA. Asegúrate de subir un archivo legible.",
        rawAiOutput: rawText
      }, { status: 500 });
    }

    // Ejecutar comparación
    const { matches, unmatchedYoy, unmatchedBank } = reconcileTransactions(yoyTransactions || [], bankTransactions);

    // Calcular estadísticas
    const totalYoYMonto = (yoyTransactions || []).reduce((s, t) => s + (Math.abs(Number(t.monto)) || 0), 0);
    const totalBankMonto = bankTransactions.reduce((s, t) => s + Math.abs(t.monto), 0);

    return NextResponse.json({
      success: true,
      summary: {
        totalYoYCount: (yoyTransactions || []).length,
        totalBankCount: bankTransactions.length,
        matchedCount: matches.length,
        unmatchedYoyCount: unmatchedYoy.length,
        unmatchedBankCount: unmatchedBank.length,
        totalYoYMonto,
        totalBankMonto
      },
      matches,
      unmatchedYoy,
      unmatchedBank
    });

  } catch (err) {
    console.error("Error general en API de conciliacion bancaria:", err);
    return NextResponse.json({ error: err.message || "Error interno del servidor." }, { status: 500 });
  }
}
