import Link from 'next/link'

import { Cta } from './client'

export default function Home() {
  return (
    <main>
      <h1>Home</h1>
      <Link id="nav-pricing" href="/pricing">Pricing</Link>
      <Cta />
    </main>
  )
}
