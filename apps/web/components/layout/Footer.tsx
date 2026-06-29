import Link from 'next/link'
import { MapPin, Phone, Mail, Instagram, Facebook, ExternalLink } from 'lucide-react'

const services = [
  { label: 'Aseo y Limpieza', href: '/servicios#aseo' },
  { label: 'Cafetería', href: '/servicios#cafeteria' },
  { label: 'Conserjería', href: '/servicios#conserjeria' },
  { label: 'Jardinería', href: '/servicios#jardineria' },
  { label: 'Servicios Especiales', href: '/servicios#especiales' },
  { label: 'Limpieza en Alturas', href: '/servicios#alturas' },
]

const links = [
  { label: 'Inicio', href: '/' },
  { label: 'Nosotros', href: '/nosotros' },
  { label: 'Seguridad y Salud', href: '/seguridad-salud' },
  { label: 'Contacto', href: '/contacto' },
  { label: 'Portal Empleados', href: 'https://inventario.conserjesinmobiliarios.com', external: true },
  { label: 'Capacitaciones', href: 'https://capacitaciones.vigiasdecolombia.com', external: true },
]

export function Footer() {
  return (
    <footer className="bg-brand-green-dark text-white">
      {/* Main footer */}
      <div className="container-max section-padding pb-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10">
          {/* Brand */}
          <div className="lg:col-span-1">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
                <span className="text-white font-heading font-bold text-lg">CI</span>
              </div>
              <div>
                <p className="font-heading font-bold text-xl leading-tight">Conserjes</p>
                <p className="font-heading font-semibold text-green-300 leading-tight">Inmobiliarios</p>
              </div>
            </div>
            <p className="text-green-100 font-body text-sm leading-relaxed mb-5">
              Empresa colombiana líder en servicios de aseo, cafetería y mantenimiento. Fundada en 1990,
              con más de 1.069 colaboradores comprometidos con la excelencia.
            </p>
            <p className="text-green-300 font-body text-xs font-medium">NIT: 800093388-2</p>
            <div className="flex gap-3 mt-4">
              <a
                href="https://instagram.com/conserjes_inmobiliarios"
                target="_blank"
                rel="noopener noreferrer"
                className="w-9 h-9 bg-white/10 hover:bg-white/20 rounded-lg flex items-center justify-center transition-colors"
                aria-label="Instagram"
              >
                <Instagram className="w-4 h-4" />
              </a>
              <a
                href="https://facebook.com/ConserjesInmobiliarios"
                target="_blank"
                rel="noopener noreferrer"
                className="w-9 h-9 bg-white/10 hover:bg-white/20 rounded-lg flex items-center justify-center transition-colors"
                aria-label="Facebook"
              >
                <Facebook className="w-4 h-4" />
              </a>
            </div>
          </div>

          {/* Services */}
          <div>
            <h3 className="font-heading font-semibold text-lg mb-5">Servicios</h3>
            <ul className="space-y-2.5">
              {services.map((s) => (
                <li key={s.href}>
                  <Link
                    href={s.href}
                    className="text-green-200 hover:text-white font-body text-sm transition-colors flex items-center gap-1.5 group"
                  >
                    <span className="w-1 h-1 rounded-full bg-green-400 group-hover:bg-white transition-colors" />
                    {s.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Links */}
          <div>
            <h3 className="font-heading font-semibold text-lg mb-5">Empresa</h3>
            <ul className="space-y-2.5">
              {links.map((l) => (
                <li key={l.href}>
                  {l.external ? (
                    <a
                      href={l.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-green-200 hover:text-white font-body text-sm transition-colors flex items-center gap-1.5 group"
                    >
                      <span className="w-1 h-1 rounded-full bg-green-400 group-hover:bg-white transition-colors" />
                      {l.label}
                      <ExternalLink className="w-3 h-3 opacity-50" />
                    </a>
                  ) : (
                    <Link
                      href={l.href}
                      className="text-green-200 hover:text-white font-body text-sm transition-colors flex items-center gap-1.5 group"
                    >
                      <span className="w-1 h-1 rounded-full bg-green-400 group-hover:bg-white transition-colors" />
                      {l.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="font-heading font-semibold text-lg mb-5">Contacto</h3>
            <ul className="space-y-4">
              <li className="flex items-start gap-3">
                <MapPin className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
                <span className="text-green-100 font-body text-sm leading-relaxed">
                  Carrera 19 # 166-34<br />
                  Toberín, Bogotá D.C.<br />
                  Colombia
                </span>
              </li>
              <li className="flex items-center gap-3">
                <Phone className="w-4 h-4 text-green-400 shrink-0" />
                <div className="text-sm">
                  <a
                    href="tel:+573208081399"
                    className="text-green-100 hover:text-white font-body transition-colors block"
                  >
                    +57 320 808 1399
                  </a>
                  <a
                    href="tel:6017926517"
                    className="text-green-200 hover:text-white font-body transition-colors text-xs"
                  >
                    PBX: 601 792 6517
                  </a>
                </div>
              </li>
              <li className="flex items-center gap-3">
                <Mail className="w-4 h-4 text-green-400 shrink-0" />
                <a
                  href="mailto:juridicaconserjesinmobiliarios@gmail.com"
                  className="text-green-100 hover:text-white font-body text-xs transition-colors break-all"
                >
                  juridicaconserjesinmobiliarios@gmail.com
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-white/10">
        <div className="container-max px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-green-300 font-body text-xs text-center sm:text-left">
            © {new Date().getFullYear()} Conserjes Inmobiliarios Ltda. Todos los derechos reservados.
          </p>
          <p className="text-green-400 font-body text-xs">
            Ley 1581 de 2012 — Habeas Data Colombia
          </p>
        </div>
      </div>
    </footer>
  )
}
