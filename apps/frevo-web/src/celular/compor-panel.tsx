// The compor phase on the phone: the bloco's name and refrain so far, what is
// on the vote (the same options on every phone of the bloco) and how many
// already voted, also after this phone voted.
import type { ComposeView } from "@gambiarra-lab/frevo/snapshot";
import { roundLine, roundTitle } from "./compor-text";

export function ComporPanel({ compor }: { compor: ComposeView }) {
  return (
    <section aria-live="polite" className="celular-compor">
      <h2>{roundTitle(compor)}</h2>
      {compor.name ? (
        <p className="celular-compor-name">
          Nome: <strong>{compor.name}</strong>
        </p>
      ) : null}
      {compor.refrain ? (
        <blockquote className="celular-compor-refrain">
          {compor.refrain.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </blockquote>
      ) : null}
      <p className="celular-compor-status">{roundLine(compor)}</p>
      {compor.voting ? (
        <ol className="celular-compor-options">
          {compor.options.map((option, index) => (
            <li
              data-mine={compor.yourVote === index ? "sim" : undefined}
              key={option.lines.join("\n")}
            >
              {option.lines.map((line) => (
                <span key={line}>{line}</span>
              ))}
              <small>
                {option.by ? `proposta de ${option.by}` : "o refrão de agora"}
                {compor.yourVote === index ? " · seu voto" : ""}
              </small>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
