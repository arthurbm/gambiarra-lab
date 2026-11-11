// How to join, over the square while the entrance is open: three steps in
// big letters, so a room that just sat down knows what to do with the QR
// beside it. It leaves when the host starts the dynamic.
const STEPS = [
  "Aponte a câmera do celular para o QR",
  "Diga seu nome e ganhe um boneco",
  "Responda a ele e ache seu nome na praça",
];

export function EntradaGuide({ people }: { people: number }) {
  return (
    <section aria-label="Como entrar" className="entrada-guide">
      <h2>
        Como entrar
        <small>
          {people === 0
            ? "A praça está esperando você"
            : `${people} ${people === 1 ? "boneco" : "bonecos"} na praça`}
        </small>
      </h2>
      <ol>
        {STEPS.map((step, index) => (
          <li key={step}>
            <span className="entrada-guide-number">{index + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
