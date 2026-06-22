async function test() {
  try {
    const res = await fetch('https://yoy-ia-billar.vercel.app/api/inspect');
    const data = await res.json();
    console.log("Status:", res.status);
    console.log("Response:", JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("Test failed:", e);
  }
}
test();
