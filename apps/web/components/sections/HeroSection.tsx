'use client'

import Link from 'next/link'
import { ArrowRight, CheckCircle, ChevronDown, Briefcase } from 'lucide-react'

const highlights = [
  '36 años de experiencia comprobada',
  'Más de 1.069 colaboradores calificados',
  'Certificados en trabajo en alturas',
]

export function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Background image placeholder — replace with your actual hero image */}
      <div className="absolute inset-0 z-0">
        {/* Image slot — drop your hero image here */}
        <div className="absolute inset-0 bg-[url('/images/hero-bg.jpg')] bg-cover bg-center bg-no-repeat" />
        {/* Gradient overlay */}
        <div className="absolute inset-0 gradient-hero" />
        {/* Pattern overlay */}
        <div
          className="absolute inset-0 opacity-5"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }}
        />
      </div>

      {/* Content */}
      <div className="relative z-10 container-max px-4 sm:px-6 lg:px-8 pt-28 pb-16">
        <div className="max-w-3xl">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 text-white/90 text-sm font-body font-medium px-4 py-2 rounded-full mb-8">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            Empresa líder en Colombia desde 1990
          </div>

          {/* Headline */}
          <h1 className="font-heading font-bold text-5xl sm:text-6xl lg:text-7xl text-white leading-[1.05] mb-6">
            Limpieza y{' '}
            <span className="text-green-300">mantenimiento</span>{' '}
            que transforma
            <br />
            <span className="text-white/90">tu empresa</span>
          </h1>

          {/* Subheading */}
          <p className="text-green-100 font-body text-xl leading-relaxed mb-8 max-w-2xl">
            Soluciones integrales de aseo, cafetería, conserjería y jardinería para empresas en
            Bogotá y toda Colombia. Confiabilidad, calidad y respeto por el medio ambiente.
          </p>

          {/* Highlights */}
          <ul className="space-y-2.5 mb-10">
            {highlights.map((item) => (
              <li key={item} className="flex items-center gap-2.5 text-green-100 font-body">
                <CheckCircle className="w-5 h-5 text-green-400 shrink-0" />
                {item}
              </li>
            ))}
          </ul>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row flex-wrap gap-4">
            <Link
              href="/contacto"
              className="inline-flex items-center justify-center gap-2.5 bg-white text-brand-green font-body font-bold text-base px-8 py-4 rounded-xl hover:bg-green-50 transition-all duration-200 shadow-xl hover:shadow-2xl hover:-translate-y-0.5 group"
            >
              Solicitar cotización
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link
              href="/registro-vacantes"
              className="inline-flex items-center justify-center gap-2.5 bg-brand-orange text-white font-body font-bold text-base px-8 py-4 rounded-xl hover:bg-brand-orange-light transition-all duration-200 shadow-xl hover:shadow-2xl hover:-translate-y-0.5 group"
            >
              <Briefcase className="w-5 h-5" />
              Trabaja con nosotros
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link
              href="/servicios"
              className="inline-flex items-center justify-center gap-2 bg-white/10 backdrop-blur-sm border-2 border-white/30 text-white font-body font-semibold text-base px-8 py-4 rounded-xl hover:bg-white/20 hover:border-white/50 transition-all duration-200"
            >
              Ver servicios
            </Link>
          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 text-white/60 flex flex-col items-center gap-2 animate-bounce">
        <span className="text-xs font-body uppercase tracking-widest">Descubrir</span>
        <ChevronDown className="w-5 h-5" />
      </div>

      {/* Bottom wave */}
      <div className="absolute bottom-0 left-0 right-0 z-10">
        <svg
          viewBox="0 0 1440 80"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="none"
          className="w-full h-16"
        >
          <path
            d="M0 80L60 72C120 64 240 48 360 40C480 32 600 32 720 38C840 44 960 56 1080 60C1200 64 1320 60 1380 58L1440 56V80H1380C1320 80 1200 80 1080 80C960 80 840 80 720 80C600 80 480 80 360 80C240 80 120 80 60 80H0Z"
            fill="white"
          />
        </svg>
      </div>
    </section>
  )
}
