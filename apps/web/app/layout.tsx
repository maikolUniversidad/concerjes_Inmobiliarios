import type { Metadata } from 'next'
import { Montserrat, Open_Sans } from 'next/font/google'
import './globals.css'
import { Toaster } from 'sonner'

const montserrat = Montserrat({
  subsets: ['latin'],
  variable: '--font-montserrat',
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
})

const openSans = Open_Sans({
  subsets: ['latin'],
  variable: '--font-open-sans',
  weight: ['400', '500', '600'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'Conserjes Inmobiliarios Ltda | Aseo, Cafetería y Mantenimiento',
    template: '%s | Conserjes Inmobiliarios',
  },
  description:
    'Empresa líder en servicios de aseo, cafetería, conserjería, jardinería y mantenimiento en Colombia. 36 años de experiencia, más de 1.069 colaboradores. NIT 800093388-2.',
  keywords: [
    'conserjes inmobiliarios',
    'servicios de aseo bogota',
    'limpieza empresarial colombia',
    'conserjería bogotá',
    'aseo y cafetería',
    'mantenimiento locativo',
    'limpieza en alturas',
    'jardinería empresarial',
  ],
  authors: [{ name: 'Conserjes Inmobiliarios Ltda' }],
  creator: 'Conserjes Inmobiliarios Ltda',
  metadataBase: new URL('https://conserjesinmobiliarios.com'),
  openGraph: {
    type: 'website',
    locale: 'es_CO',
    url: 'https://conserjesinmobiliarios.com',
    siteName: 'Conserjes Inmobiliarios Ltda',
    title: 'Conserjes Inmobiliarios Ltda | 36 años de excelencia',
    description:
      'Soluciones integrales de aseo, cafetería, conserjería y mantenimiento para empresas en Colombia.',
    images: [
      {
        url: '/images/og-image.jpg',
        width: 1200,
        height: 630,
        alt: 'Conserjes Inmobiliarios Ltda',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Conserjes Inmobiliarios Ltda',
    description: 'Servicios de aseo, cafetería y mantenimiento en Colombia.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  verification: {
    google: '',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="es"
      className={`${montserrat.variable} ${openSans.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Google Tag Manager */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-W5PC7HRC');`,
          }}
        />
      </head>
      <body>
        {/* Google Tag Manager (noscript) */}
        <noscript>
          <iframe
            src="https://www.googletagmanager.com/ns.html?id=GTM-W5PC7HRC"
            height="0"
            width="0"
            style={{ display: 'none', visibility: 'hidden' }}
          />
        </noscript>
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  )
}
