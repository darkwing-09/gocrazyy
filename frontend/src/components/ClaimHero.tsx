import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import {
  Minus,
  Plus,
  Globe,
  ChevronDown,
  Percent,
  Ticket,
  Loader2,
  MapPin,
  Rocket,
  Phone,
  Sparkles,
  AtSign,
} from 'lucide-react'
import { LinkedInIcon } from './Icon'
import clsx from 'clsx'
import { Button } from './Button'
import { CheckoutDialog, type CheckoutState } from './CheckoutDialog'
import { api, type ClaimResult, type Quote } from '@/lib/api'
import { useAppData } from '@/lib/app-data'
import { useTheme } from '@/lib/theme'
import { dataFastVisitorId } from '@/lib/datafast'
import { openCheckout } from '@/lib/razorpay'
import { rupeesPlain } from '@/lib/format'

export type ClaimHeroHandle = { prefill: (o: { amountPaise?: number; url?: string }) => void }

type Props = {
  board: 'main' | 'deals'
  category: string | null
  takeTopPaise: number | null
  onPaid: () => void
  onAmountChange?: (paise: number | null) => void
}

export const ClaimHero = forwardRef<ClaimHeroHandle, Props>(function ClaimHero(
  { board, category, takeTopPaise, onPaid, onAmountChange },
  ref
) {
  const { categories, meta } = useAppData()
  const { accent, reducedMotion } = useTheme()
  const step = meta?.pricing.step ?? 1000
  const [amount, setAmount] = useState<number | null>(null)
  const [url, setUrl] = useState('')
  const [cat, setCat] = useState<string>(category ?? '')
  const [deal, setDeal] = useState('')
  const [coupon, setCoupon] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [terms, setTerms] = useState(false)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checkout, setCheckout] = useState<CheckoutState | null>(null)
  const [sweep, setSweep] = useState(0)

  // Optional startup details & contacts
  const [location, setLocation] = useState('')
  const [stage, setStage] = useState('')
  const [twitter, setTwitter] = useState('')
  const [linkedin, setLinkedin] = useState('')
  const [contactPhone, setContactPhone] = useState('')

  const urlRef = useRef<HTMLInputElement>(null)
  const catName = categories.find((c) => c.slug === category)?.name

  useEffect(() => {
    if (takeTopPaise !== null && amount === null) setAmount(takeTopPaise)
  }, [takeTopPaise]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setCat(category ?? '')
    setAmount(takeTopPaise)
  }, [category, board]) // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    prefill: ({ amountPaise, url: u }) => {
      if (amountPaise !== undefined) {
        setAmount(amountPaise)
        setSweep((s) => s + 1)
      }
      if (u) setUrl(u)
      document.getElementById('claim')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setTimeout(() => urlRef.current?.focus(), 400)
    },
  }))

  useEffect(() => {
    onAmountChange?.(amount)
  }, [amount]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fetch and poll for pending orders every 10 seconds so it never misses
  useEffect(() => {
    let timer: any = null
    const checkPendingOrder = async () => {
      try {
        const stored = localStorage.getItem('gocrazy_pending_order')
        if (!stored) return
        const parsed = JSON.parse(stored)
        if (!parsed.order_id || Date.now() - (parsed.created_at || 0) > 2 * 60 * 60 * 1000) {
          localStorage.removeItem('gocrazy_pending_order')
          return
        }
        const status = await api.checkStatus(parsed.order_id)
        if (status.paid) {
          localStorage.removeItem('gocrazy_pending_order')
          onPaid()
        }
      } catch {}
    }

    checkPendingOrder()
    timer = setInterval(checkPendingOrder, 10000)
    return () => {
      if (timer) clearInterval(timer)
    }
  }, [onPaid])

  // Live quote
  useEffect(() => {
    if (amount === null) return
    const id = setTimeout(() => {
      api
        .quote({ amount_paise: amount, category: category ?? undefined, board, url: url.trim() || undefined })
        .then(setQuote)
        .catch(() => {})
    }, 180)
    return () => clearTimeout(id)
  }, [amount, category, board, url])

  const bump = (dir: 1 | -1) => {
    setAmount((a) => Math.max(0, Math.min(meta?.pricing.max ?? 50_000_000, (a ?? 0) + dir * step)))
    setSweep((s) => s + 1)
  }

  // The optional details appear once the two required listing fields are in.
  const detailsOpen = !!url.trim() && !!cat

  const min =
    quote?.min_paise ??
    (board === 'deals' ? meta?.pricing.min_new_deal ?? 900 : meta?.pricing.min_new ?? 900)
  // A valid 10-digit Indian mobile, pre-filled into Razorpay so the buyer skips the contact step.
  const phoneDigits = phone.replace(/\D/g, '')
  const phoneValid = /^[6-9]\d{9}$/.test(phoneDigits)
  const valid =
    !!url.trim() &&
    !!cat &&
    phoneValid &&
    amount !== null &&
    amount >= min &&
    terms &&
    (board !== 'deals' || deal.trim().length > 0)

  const submit = async () => {
    if (!valid || amount === null) return
    setBusy(true)
    setError(null)
    try {
      const claim: ClaimResult = await api.claim({
        url: url.trim(),
        category: cat,
        amount_paise: amount,
        board,
        accept_terms: true,
        deal_text: board === 'deals' ? deal.trim() : null,
        coupon: board === 'deals' ? coupon.trim() || null : null,
        email: email.trim() || null,
        df_visitor_id: dataFastVisitorId(),
        location: location.trim() || null,
        stage: stage.trim() || null,
        twitter: twitter.trim() || null,
        linkedin: linkedin.trim() || null,
        contact_phone: phoneDigits ? `+91${phoneDigits}` : (contactPhone.trim() || null),
        phone: phoneDigits ? `+91${phoneDigits}` : (contactPhone.trim() || null),
      })
      if (claim.mode === 'upi_gateway') {
        if (claim.payment_url) {
          try {
            localStorage.setItem(
              'gocrazy_pending_order',
              JSON.stringify({
                order_id: claim.order_id,
                domain: claim.listing.domain,
                amount_paise: claim.amount_paise,
                created_at: Date.now(),
              })
            )
          } catch {}
          window.location.href = claim.payment_url
          return
        }
        setCheckout({ kind: 'upi', claim })
      } else if (claim.mode === 'razorpay' && claim.key_id) {
        setCheckout({ kind: 'waiting', claim })
        await openCheckout({
          keyId: claim.key_id,
          orderId: claim.order_id,
          amountPaise: claim.amount_paise,
          title: claim.listing.title,
          description: `GoCrazy advertising – ${claim.listing.domain}`,
          accentHex: accent.hex,
          email: email.trim() || undefined,
          contact: '+91' + phoneDigits,
          onDismiss: () => setCheckout(null),
          onSuccess: async (r) => {
            setCheckout({ kind: 'verifying', claim })
            try {
              const res = await api.verify(r)
              setCheckout({ kind: 'done', claim, result: res })
              onPaid()
            } catch (e) {
              setCheckout({ kind: 'error', claim, message: (e as Error).message })
            }
          },
        })
      } else {
        setCheckout({ kind: 'mock', claim })
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const mockPay = async (claim: ClaimResult) => {
    setCheckout({ kind: 'verifying', claim })
    try {
      const res = await api.mockPay(claim.order_id)
      setCheckout({ kind: 'done', claim, result: res })
      onPaid()
    } catch (e) {
      setCheckout({ kind: 'error', claim, message: (e as Error).message })
    }
  }

  const rank = quote?.rank ?? 1
  const where = catName ? ` in ${catName}` : ''
  const on = board === 'deals' ? ' on Deals' : ''

  return (
    <section id="claim" className="scroll-mt-24 pt-10 pb-4">
      {/* Hero Stepper Headline */}
      <h1 className="display text-lift balance text-center text-[2.2rem] leading-[1.08] font-bold tracking-tight text-ink sm:text-[2.9rem] md:text-[3.5rem]">
        Feature at{' '}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={rank}
            initial={reducedMotion ? false : { opacity: 0, y: 12, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={reducedMotion ? undefined : { opacity: 0, y: -12, filter: 'blur(6px)' }}
            transition={{ duration: 0.3 }}
            className="tnum inline-block text-accent"
          >
            #{rank}
          </motion.span>
        </AnimatePresence>
        {where}
        {on} for{' '}
        <span className="inline-flex items-center gap-2.5 align-baseline whitespace-nowrap">
          <motion.button
            type="button"
            whileTap={{ scale: 0.92 }}
            onClick={() => bump(-1)}
            aria-label={`Decrease by ₹${step / 100}`}
            className="inline-flex size-7.5 items-center justify-center rounded-full border border-accent/30 bg-accent-subtle text-accent transition hover:bg-accent hover:text-accent-ink hover:shadow-[var(--accent-glow)] cursor-pointer sm:size-9"
          >
            <Minus className="size-4" strokeWidth={2.5} />
          </motion.button>

          <span
            className="sweep rounded-2xl px-2 py-0.5 text-accent border border-accent/25 bg-accent-subtle shadow-[0_0_24px_-4px_var(--accent-subtle)]"
            data-sweep={sweep ? '1' : '0'}
            key={sweep}
          >
            <span className="tnum font-mono font-bold tracking-tight text-[1.05em]">
              ₹{amount !== null ? rupeesPlain(amount) : '—'}
            </span>
          </span>

          <motion.button
            type="button"
            whileTap={{ scale: 0.92 }}
            onClick={() => bump(1)}
            aria-label={`Increase by ₹${step / 100}`}
            className="inline-flex size-7.5 items-center justify-center rounded-full border border-accent/30 bg-accent-subtle text-accent transition hover:bg-accent hover:text-accent-ink hover:shadow-[var(--accent-glow)] cursor-pointer sm:size-9"
          >
            <Plus className="size-4" strokeWidth={2.5} />
          </motion.button>
        </span>
      </h1>

      {/* Form Card */}
      <form onSubmit={(e) => { e.preventDefault(); submit() }} className="mx-auto mt-7 max-w-2xl">
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <label className="relative flex-1">
            <Globe className="pointer-events-none absolute top-1/2 left-3.5 z-10 size-4 -translate-y-1/2 text-ink-2" />
            <input
              ref={urlRef}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Your startup URL or @handle *"
              aria-label="Startup URL or handle (required)"
              aria-required="true"
              inputMode="url"
              autoComplete="url"
              className="h-12 w-full rounded-full bg-surface/95 backdrop-blur-md pr-4 pl-10 text-[14.5px] font-medium text-ink hairline placeholder:text-ink-3 transition duration-200 outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent"
            />
          </label>
          <label className="relative sm:w-56">
            <select
              value={cat}
              onChange={(e) => setCat(e.target.value)}
              aria-label="Category (required)"
              aria-required="true"
              className={clsx(
                'h-12 w-full appearance-none rounded-full bg-surface/95 backdrop-blur-md pr-9 pl-4 text-[14px] font-medium hairline outline-none [&_option]:bg-raised [&_option]:text-ink transition duration-200 focus:border-accent/40 focus:ring-1 focus:ring-accent cursor-pointer',
                cat ? 'text-ink' : 'text-ink-3'
              )}
            >
              <option value="" disabled>Choose a category *</option>
              {categories.map((c) => (
                <option key={c.slug} value={c.slug}>{c.name}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute top-1/2 right-3.5 z-10 size-4 -translate-y-1/2 text-ink-2" />
          </label>
        </div>

        {board === 'deals' && (
          <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
            <label className="relative flex-1">
              <Percent className="pointer-events-none absolute top-1/2 left-3.5 z-10 size-4 -translate-y-1/2 text-ink-2" />
              <input
                value={deal}
                maxLength={100}
                onChange={(e) => setDeal(e.target.value)}
                placeholder="Describe your discount, e.g. 50% off for 6 months *"
                aria-label="Discount (required)"
                aria-required="true"
                className="h-12 w-full rounded-full bg-surface/95 backdrop-blur-md pr-14 pl-10 text-[14.5px] font-medium text-ink hairline placeholder:text-ink-3 outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent"
              />
              <span className="tnum absolute top-1/2 right-4 -translate-y-1/2 font-mono text-[11px] font-medium text-ink-3">
                {deal.length}/100
              </span>
            </label>
            <label className="relative sm:w-56">
              <Ticket className="pointer-events-none absolute top-1/2 left-3.5 z-10 size-4 -translate-y-1/2 text-ink-2" />
              <input
                value={coupon}
                maxLength={60}
                onChange={(e) => setCoupon(e.target.value)}
                placeholder="Coupon code"
                aria-label="Coupon code"
                className="h-12 w-full rounded-full bg-surface/95 backdrop-blur-md pr-4 pl-10 text-[14.5px] font-medium text-ink hairline placeholder:text-ink-3 outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent"
              />
            </label>
          </div>
        )}

        {/* Startup details & contacts: revealed once the required URL and category are filled */}
        <div className="text-left">
          <AnimatePresence initial={false}>
            {detailsOpen && (
              <motion.div
                initial={reducedMotion ? false : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={reducedMotion ? undefined : { opacity: 0, height: 0 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden pt-3"
              >
                <fieldset className="space-y-2.5 rounded-3xl border border-line-strong bg-surface p-4">
                  <legend className="sr-only">Startup details and contacts</legend>
                  <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <p className="flex items-center gap-1.5 text-[13.5px] font-semibold text-ink">
                      <Sparkles className="size-3.5 text-accent" />
                      Startup details & contacts
                    </p>
                    <span className="text-[12px] font-medium text-ink-3">Optional · shown on your listing page</span>
                  </div>
                  <p className="text-[13px] text-ink-2">
                    Help customers and investors reach you directly through your GoCrazy listing.
                  </p>

                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <label className="relative">
                      <MapPin className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
                      <input
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        placeholder="HQ / City (e.g. Bengaluru, Remote)"
                        aria-label="Location"
                        className="h-10 w-full rounded-full bg-raised pr-3 pl-9 text-[13.5px] font-medium text-ink hairline placeholder:text-ink-3 outline-none transition focus:ring-1 focus:ring-accent"
                      />
                    </label>

                    <label className="relative">
                      <Rocket className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
                      <input
                        value={stage}
                        onChange={(e) => setStage(e.target.value)}
                        placeholder="Stage (e.g. Bootstrapped, Seed, Series A)"
                        aria-label="Startup Stage"
                        className="h-10 w-full rounded-full bg-raised pr-3 pl-9 text-[13.5px] font-medium text-ink hairline placeholder:text-ink-3 outline-none transition focus:ring-1 focus:ring-accent"
                      />
                    </label>
                  </div>

                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                    <label className="relative">
                      <AtSign className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
                      <input
                        value={twitter}
                        onChange={(e) => setTwitter(e.target.value)}
                        placeholder="Twitter / X (@handle)"
                        aria-label="Twitter handle"
                        className="h-10 w-full rounded-full bg-raised pr-3 pl-9 text-[13.5px] font-medium text-ink hairline placeholder:text-ink-3 outline-none transition focus:ring-1 focus:ring-accent"
                      />
                    </label>

                    <label className="relative">
                      <LinkedInIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
                      <input
                        value={linkedin}
                        onChange={(e) => setLinkedin(e.target.value)}
                        placeholder="LinkedIn (profile / page)"
                        aria-label="LinkedIn profile"
                        className="h-10 w-full rounded-full bg-raised pr-3 pl-9 text-[13.5px] font-medium text-ink hairline placeholder:text-ink-3 outline-none transition focus:ring-1 focus:ring-accent"
                      />
                    </label>

                    <label className="relative">
                      <Phone className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
                      <input
                        value={contactPhone}
                        onChange={(e) => setContactPhone(e.target.value)}
                        placeholder="WhatsApp number"
                        aria-label="Phone or WhatsApp"
                        className="h-10 w-full rounded-full bg-raised pr-3 pl-9 text-[13.5px] font-medium text-ink hairline placeholder:text-ink-3 outline-none transition focus:ring-1 focus:ring-accent"
                      />
                    </label>
                  </div>
                </fieldset>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="mt-3.5 flex flex-col items-center justify-between gap-2.5 text-[12.5px] font-medium text-ink-2 sm:flex-row">
          <label className="text-lift flex items-center gap-2 cursor-pointer text-ink-2">
            <input
              type="checkbox"
              aria-required="true"
              checked={terms}
              onChange={(e) => setTerms(e.target.checked)}
              className="size-4 accent-accent cursor-pointer rounded"
            />
            <span>
              I accept the{' '}
              <Link to="/terms" className="text-ink underline underline-offset-4 hover:text-accent">
                Terms
              </Link>
              <span className="text-accent" aria-hidden> *</span>. Paid advertising placement, no refunds.
            </span>
          </label>
          <div className="flex w-full flex-col gap-2 sm:w-64">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[12.5px] font-medium text-ink-3">+91</span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/[^\d]/g, '').slice(0, 10))}
                inputMode="numeric"
                autoComplete="tel"
                placeholder="Mobile number *"
                aria-label="Mobile number (required for payment)"
                aria-required="true"
                className="h-8.5 w-full rounded-full bg-surface/95 backdrop-blur-md pl-11 pr-3 text-[12.5px] font-medium text-ink hairline placeholder:text-ink-3 outline-none focus:border-accent/40"
              />
            </div>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="Receipt email (optional)"
              aria-label="Email"
              className="h-8.5 w-full rounded-full bg-surface/95 backdrop-blur-md px-3 text-[12.5px] font-medium text-ink hairline placeholder:text-ink-3 outline-none focus:border-accent/40"
            />
          </div>
        </div>

        <p className="text-lift mt-2 text-center text-[12px] font-medium text-ink-2 sm:text-left"><span className="text-accent">*</span> Required</p>

        {/* Dynamic quote status */}
        <div className="text-lift mt-3 min-h-5 text-center text-[13px] font-medium" aria-live="polite">
          {error ? (
            <span className="text-[#ff6b6b] font-semibold">{error}</span>
          ) : (
            quote &&
            amount !== null && (
              amount < quote.min_paise ? (
                <span className="text-ink-2">
                  Minimum is ₹{rupeesPlain(quote.min_paise)}
                  {quote.existing ? ` to raise ${quote.existing.title}` : ' for a new listing'}.
                </span>
              ) : quote.existing ? (
                <span className="text-ink-2">
                  Raises <span className="text-ink font-semibold">{quote.existing.title}</span> from #{quote.existing.current_rank ?? '—'} to{' '}
                  <span className="text-accent font-semibold">#{quote.rank}</span> (total ₹{rupeesPlain(quote.projected_total_paise)}).
                </span>
              ) : (
                <span className="text-ink-2">
                  ₹{rupeesPlain(amount)} features you at <span className="text-accent font-semibold">#{quote.rank}</span>
                  {where}. Ad spend adds up: advertise again anytime to rank higher.
                </span>
              )
            )
          )}
        </div>
        <Button
          type="submit"
          size="lg"
          sweep
          disabled={!valid || busy}
          data-sweep={valid ? '1' : '0'}
          className="mt-4 w-full"
        >
          {busy ? <Loader2 className="size-4.5 animate-spin" /> : 'Feature now'}
        </Button>
      </form>

      <CheckoutDialog
        state={checkout}
        onClose={() => setCheckout(null)}
        onMockPay={mockPay}
        onUpiPaid={(result, claim) => {
          setCheckout({ kind: 'done', claim, result })
          onPaid()
        }}
      />
    </section>
  )
})
