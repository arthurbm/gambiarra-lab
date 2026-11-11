// The compor phase on the phone: the bloco's name and refrain so far and,
// once this phone voted (or has no vote), what is on the vote, the same
// options on every phone of the bloco. While the question is open the
// options are its buttons, so the list would only repeat them.
import type { ComposeView } from "@gambiarra-lab/frevo/snapshot";
import { optionCredit } from "./compor-text";

export function ComporPanel({
  asking,
  compor,
}: {
  /** This phone still has the vote's question open. */
  asking: boolean;
  compor: ComposeView;
}) {
  const showOptions = compor.voting && !asking;
  if (!(compor.name || compor.refrain || showOptions)) {
    return null;
  }
  return (
    <section aria-live="polite" className="celular-compor">
      <h2>O frevo do seu bloco</h2>
      {compor.name ? (
        <p>
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
      {showOptions ? (
        <>
          <p className="celular-compor-status">Na votação:</p>
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
                  {optionCredit(option, compor.round)}
                  {compor.yourVote === index ? " · seu voto" : ""}
                </small>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </section>
  );
}
