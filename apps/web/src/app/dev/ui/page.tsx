import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

const samples = ['1111111', '0000000', '1.250.000', '8888888'];

export default function DevUiPage() {
  if (process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_DEMO !== '1') notFound();

  return (
    <main className="p-4">
      <section id="angka">
        <h1 className="text-text">Angka</h1>
        <ul>
          {samples.map((s) => (
            <li key={s}>
              <span className="num text-text">{s}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
