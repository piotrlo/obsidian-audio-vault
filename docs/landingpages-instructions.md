# Prompt dla AI Agenta: AudioVault Landing Pages z Hono JSX

## Kontekst produktu
Tworzysz landing pages dla **AudioVault** - płatnej wtyczki do Obsidian, która konwertuje notatki na wysokiej jakości audio (TTS) używając Azure AI Speech. Użytkownicy mogą słuchać swoich notatek jak podcastów podczas jazdy samochodem, treningu czy sprzątania.

## Specyfikacja techniczna
- **Framework**: Cloudflare Workers + Hono.js z JSX rendering
- **Istniejący backend**: `/v1/*` API endpointy (auth, TTS, billing)
- **Deployment**: Cloudflare Workers z static assets
- **Styling**: Tailwind CSS (przez CDN)
- **Integracja**: Stripe Checkout dla płatności

## Plany cenowe
- **Free**: $0 - 10,000 znaków/miesiąc (~2 artykuły, ~13 minut audio)
- **Basic**: $8.99/miesiąc - 100,000 znaków/miesiąc (~20 artykułów, ~2h 13 minut) **MOST POPULAR**
- **Pro**: $24.99/miesiąc - 300,000 znaków/miesiąc (~60 artykułów, ~6h 40 minut)

## Strony do utworzenia

### 1. Layout Base Component
```tsx
// src/components/Layout.tsx
```
- Responsive navigation (AudioVault logo, Pricing, Upgrade CTA)
- Tailwind CSS przez CDN
- Meta tags SEO
- Dark theme compatible (Obsidian użytkownicy)

### 2. Strona główna `/`
**Inspiracja**: https://www.obsidiancopilot.com/
- **Hero section**: "Transform Your Obsidian Notes Into High-Quality Audio"
- **Value proposition**: Listen to your knowledge vault on the go
- **Features grid** (3 kolumny):
  - 🎧 High-Quality Audio (Azure AI Speech - natural voices)
  - ⚡ Instant Playback (starts in seconds, not minutes)
  - 📱 Mobile Optimized (iOS/Android, offline playback)
- **Social proof**: "Made for the Obsidian community"
- **CTA**: Start Free Trial (→ /pricing)

### 3. Pricing Page `/pricing`
- **Header**: "Simple, Transparent Pricing"
- **3-column pricing table** (Free, Basic [highlighted], Pro)
- **Features comparison** per plan
- **FAQ section**:
  - "What counts as a character?"
  - "Can I cancel anytime?" 
  - "Does it work offline?"
- **CTA buttons**: Get Started (Free) / Choose Plan (→ Stripe)

### 4. Upgrade Page `/upgrade`
**Flow**: Plugin button → Upgrade page → Stripe Checkout
- **Current plan status** (if possible)
- **Quick plan comparison**
- **Direct Stripe Checkout buttons**
- **Fallback**: Redirect to `/pricing` if no plan selected

### 5. Success Page `/success`
- **Confirmation**: "🎉 Welcome to AudioVault!"
- **Next steps**: "Your license key has been sent to your email"
- **Instructions**: How to activate in Obsidian plugin settings
- **CTA**: "Open Obsidian" (obsidian:// deep link)

### 6. Cancel Page `/cancel`
- **Friendly message**: "No worries! You can try again anytime"
- **Reasons to reconsider** (features summary)
- **CTA**: Back to Pricing

## Routing struktura
```tsx
// src/routes/pages.tsx
app.get('/', homePage)
app.get('/pricing', pricingPage)
app.get('/upgrade', upgradePage)  
app.get('/success', successPage)
app.get('/cancel', cancelPage)

// Stripe integrations
app.post('/checkout', stripeCheckout) // redirect to Stripe
app.get('/portal', stripePortal)      // customer portal
```

## Design requirements
- **Clean, professional** - podobny do Obsidian ecosystem
- **Dark/light theme compatible**
- **Mobile-first responsive**
- **Fast loading** - minimal CSS, inline critical styles
- **Accessibility** - proper contrast, keyboard navigation
- **Trust signals** - security mentions, privacy-first

## Key messaging
- **Target audience**: Obsidian power users (students, professionals, researchers)
- **Pain points**: Not enough time to read, commuting waste, accessibility needs
- **Solution**: Listen to notes like podcasts, hands-free knowledge consumption
- **Differentiators**: High-quality voices, offline playback, vault integration

## Technical integration points
- **Stripe Checkout**: POST to `/v1/billing/checkout` with plan parameter
- **License activation**: Users paste license key in plugin settings
- **Deep links**: `obsidian://show-plugin?id=audiovault` for plugin access
- **Analytics**: Track conversion funnel (landing → pricing → checkout)

## Call-to-actions hierarchy
1. **Primary**: Start Free Trial / Choose Basic Plan
2. **Secondary**: Learn More / See Pricing
3. **Tertiary**: Open Obsidian / View Documentation

## Stwórz kompletny kod dla:
1. Layout component z navigation
2. Wszystkie 6 stron jako JSX components
3. Main routing file integrating z istniejącym API
4. Responsive Tailwind styling
5. Proper meta tags i SEO
6. Stripe integration dla checkout flow

**Wynik**: Production-ready landing pages zintegrowane z istniejącym Cloudflare Workers backend.