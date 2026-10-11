import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Section, Notice } from "@/components/ui";
import { getRelease } from "@/lib/release";

export const metadata: Metadata = { title: "Download data", description: "Download sourced Indian bank deposit rates and the accepted dataset manifest." };
export default async function DataPage() {
  const manifest = await getRelease();
  return <div className="max-w-3xl"><PageHeader title="Download data" lede="The published rate rows, their eligibility and original sources. Downloads identify an accepted release and are checked against its SHA-256 manifest." />
    <Section title="Current published schedules"><ul className="space-y-2 text-sm"><li><a className="text-accent" href="/api/data/current.csv">Download CSV</a> — flat rows for spreadsheets</li><li><a className="text-accent" href="/api/data/current.json">Download JSON</a> — complete rate cards and notes</li><li><a className="text-accent" href="/api/data/manifest.json">Release manifest</a> — SHA-256 checksums for datasets and exports</li></ul>
    {manifest ? <p className="mt-3 break-all text-xs text-muted">{manifest.rows} rows · generated {manifest.generatedAt} · release {manifest.releaseId}</p> : <p>Exports have not been generated for this deployment.</p>}</Section>
    <Section title="History and macro data"><ul className="max-h-96 space-y-1 overflow-y-auto text-sm">{manifest?.files.filter((file) => /^(rates|series|schemes|banks)\//.test(file.path) && !file.path.includes("/_")).map((file) => <li key={file.path}><a className="text-accent" href={`https://raw.githubusercontent.com/SushantKadam73/fixed-return-tracker/${manifest.revision ?? "main"}/data/${file.path}`} target="_blank" rel="noopener noreferrer">{file.path}</a></li>)}</ul><p className="mt-2 text-xs text-muted">Published releases link to the exact accepted Git commit. Before the first live publication, links follow main; compare checksums with the manifest. Git history preserves previous versions.</p></Section>
    <Section title="Subscribe to observed changes"><p className="text-sm"><a className="text-accent" href="/feed.xml">RSS</a> · <a className="text-accent" href="/feed.json">JSON Feed</a></p><p className="mt-2 text-xs text-muted">An unchanged daily check does not create a feed entry. Publication timestamps reflect when we observed a schedule, not necessarily its announcement date.</p></Section>
    <Notice>Missing values are unknown. Historical coverage varies by bank and product. Read the <Link className="text-accent" href="/methodology">methodology</Link> and <Link className="text-accent" href="/coverage">coverage report</Link> before using the data. Rate data does not establish bank safety.</Notice>
  </div>;
}
