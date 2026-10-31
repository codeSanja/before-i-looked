import type { DigestNight, DigestRow } from '../digest/types.js';

const dash = '—';

// Retries of 3 or more and any fail, even one a later run recovered from. Marked by class and
// by text, so the mark survives without colour.
function marks(row: DigestRow): string[] {
  return [
    ...(row.fails > 0 ? [`${row.fails} failed`] : []),
    ...(row.retries >= 3 ? [`${row.retries} retries`] : []),
  ];
}

export function DigestPage({ digest }: { digest: DigestNight }) {
  const { rows, badLines } = digest;
  return (
    <>
      <h1>digest {digest.night}</h1>
      {badLines > 0 && <p class="warn">{badLines} bad {badLines === 1 ? 'line' : 'lines'}</p>}
      {rows.length === 0 && badLines === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>job</th>
              <th>owner</th>
              <th>runs</th>
              <th>retries</th>
              <th>last status</th>
              <th>last error</th>
              <th>first</th>
              <th>last</th>
              <th>marked</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr class={marks(r).length > 0 ? 'warn' : undefined}>
                <td>{r.job}</td>
                <td>{r.owner ?? dash}</td>
                <td>{r.runs}</td>
                <td>{r.retries}</td>
                <td>{r.lastStatus}</td>
                <td>{r.lastError ?? dash}</td>
                <td>{r.firstAt}</td>
                <td>{r.lastAt}</td>
                <td>{marks(r).join(' · ') || dash}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export function DigestNotFound({ night }: { night: string }) {
  return (
    <>
      <h1>digest {night}</h1>
      <p class="mute">no run log for this night</p>
    </>
  );
}
