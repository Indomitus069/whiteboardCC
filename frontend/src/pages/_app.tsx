import type { AppProps } from 'next/app'
import 'tldraw/tldraw.css'

export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />
}
