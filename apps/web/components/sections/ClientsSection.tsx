export function ClientsSection() {
  const clientTypes = [
    { icon: '🏢', label: 'Empresas inmobiliarias' },
    { icon: '🏗️', label: 'Constructoras' },
    { icon: '🏛️', label: 'Entidades públicas' },
    { icon: '🏠', label: 'Conjuntos residenciales' },
    { icon: '🏦', label: 'Entidades bancarias' },
    { icon: '🏥', label: 'Clínicas y hospitales' },
    { icon: '🎓', label: 'Universidades' },
    { icon: '🛍️', label: 'Centros comerciales' },
  ]

  return (
    <section className="section-padding bg-white border-t border-gray-100">
      <div className="container-max">
        <div className="text-center mb-12">
          <p className="font-body text-brand-gray-mid text-sm font-semibold uppercase tracking-widest mb-4">
            Nuestros clientes confían en nosotros
          </p>
          <h2 className="font-heading font-bold text-3xl sm:text-4xl text-brand-gray-dark">
            Sectores que atendemos
          </h2>
        </div>

        {/* Client logos placeholder grid */}
        <div className="mb-12">
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="aspect-square bg-gray-50 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center hover:border-brand-green/30 hover:bg-brand-green/3 transition-colors"
              >
                <span className="text-xs font-body text-gray-400 text-center p-1">Logo {i + 1}</span>
              </div>
            ))}
          </div>
          <p className="text-center text-xs font-body text-gray-400 mt-3">
            [ Reemplazar con logos de clientes reales — 160×80px recomendado ]
          </p>
        </div>

        {/* Sector cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-4">
          {clientTypes.map((c) => (
            <div
              key={c.label}
              className="text-center p-4 rounded-xl bg-gray-50 hover:bg-brand-green/5 hover:shadow-sm transition-all duration-200 group"
            >
              <span className="text-3xl block mb-2 group-hover:scale-110 transition-transform">{c.icon}</span>
              <span className="font-body text-xs text-gray-600 font-medium leading-tight">{c.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
