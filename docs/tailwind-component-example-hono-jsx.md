Vanilla HTML/CSS/JS z Hono JSX (Rekomendowana)
Zalety: Najszybsze ładowanie, minimalna złożoność, idealne do prostych stron sprzedażowych

Struktura projektu:
text
audiovault-backend/
├── src/
│   ├── routes/
│   │   ├── pages.tsx         # Strony sprzedażowe
│   │   └── api.ts           # Istniejące API
│   ├── components/
│   │   ├── Layout.tsx       # Base layout
│   │   ├── PricingTable.tsx # Tabela cenowa
│   │   └── Hero.tsx         # Sekcja hero
│   └── styles/
│       └── main.css         # Tailwind lub custom CSS
Implementacja z Hono JSX:
tsx
// src/components/Layout.tsx
import { FC } from 'hono/jsx'

export const Layout: FC<{title: string}> = ({ children, title }) => {
  return (
    <html>
      <head>
        <title>{title}</title>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet" />
      </head>
      <body class="bg-gray-50">
        {children}
      </body>
    </html>
  )
}

// src/components/PricingTable.tsx
export const PricingTable: FC = () => {
  return (
    <div class="max-w-7xl mx-auto px-4 py-16">
      <div class="grid md:grid-cols-3 gap-8">
        {/* Free Plan */}
        <div class="bg-white rounded-lg shadow-lg p-6">
          <h3 class="text-xl font-bold">Free</h3>
          <div class="text-3xl font-bold text-gray-900">$0</div>
          <p class="text-gray-600">10,000 characters/month</p>
          <button class="w-full mt-6 bg-blue-600 text-white py-2 rounded-lg">
            Get Started
          </button>
        </div>
        
        {/* Basic Plan */}
        <div class="bg-white rounded-lg shadow-lg p-6 border-2 border-blue-500">
          <div class="text-center text-blue-500 font-semibold mb-2">Most Popular</div>
          <h3 class="text-xl font-bold">Basic</h3>
          <div class="text-3xl font-bold text-gray-900">$8.99</div>
          <p class="text-gray-600">100,000 characters/month</p>
          <button class="w-full mt-6 bg-blue-600 text-white py-2 rounded-lg">
            Choose Basic
          </button>
        </div>
        
        {/* Pro Plan */}
        <div class="bg-white rounded-lg shadow-lg p-6">
          <h3 class="text-xl font-bold">Pro</h3>
          <div class="text-3xl font-bold text-gray-900">$24.99</div>
          <p class="text-gray-600">300,000 characters/month</p>
          <button class="w-full mt-6 bg-blue-600 text-white py-2 rounded-lg">
            Choose Pro
          </button>
        </div>
      </div>
    </div>
  )
}

// src/routes/pages.tsx
import { Hono } from 'hono'
import { jsxRenderer } from 'hono/jsx-renderer'
import { Layout } from '../components/Layout'
import { PricingTable } from '../components/PricingTable'

const pages = new Hono()

pages.use('*', jsxRenderer())

pages.get('/', (c) => {
  return c.render(
    <Layout title="AudioVault - Transform Your Notes Into Audio">
      <div class="min-h-screen">
        {/* Hero Section */}
        <div class="bg-gradient-to-r from-blue-600 to-purple-700 text-white py-20">
          <div class="max-w-4xl mx-auto text-center px-4">
            <h1 class="text-5xl font-bold mb-6">
              Transform Your Obsidian Notes Into High-Quality Audio
            </h1>
            <p class="text-xl mb-8">
              Listen to your knowledge vault on the go. Perfect for commutes, workouts, and multitasking.
            </p>
            <a href="/pricing" class="bg-white text-blue-600 px-8 py-3 rounded-lg font-semibold text-lg">
              Start Free Trial
            </a>
          </div>
        </div>

        {/* Features */}
        <div class="py-16 bg-white">
          <div class="max-w-6xl mx-auto px-4">
            <div class="grid md:grid-cols-3 gap-8">
              <div class="text-center">
                <h3 class="text-xl font-bold mb-4">🎧 High-Quality Audio</h3>
                <p>Azure AI Speech technology for natural-sounding voices</p>
              </div>
              <div class="text-center">
                <h3 class="text-xl font-bold mb-4">⚡ Instant Playback</h3>
                <p>Audio starts playing in seconds, not minutes</p>
              </div>
              <div class="text-center">
                <h3 class="text-xl font-bold mb-4">📱 Mobile Optimized</h3>
                <p>Works seamlessly on iOS and Android</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
})

pages.get('/pricing', (c) => {
  return c.render(
    <Layout title="Pricing - AudioVault">
      <div class="py-20">
        <div class="text-center mb-16">
          <h1 class="text-4xl font-bold mb-4">Simple, Transparent Pricing</h1>
          <p class="text-xl text-gray-600">Choose the plan that fits your needs</p>
        </div>
        <PricingTable />
      </div>
    </Layout>
  )
})

pages.get('/upgrade', (c) => {
  // Przekierowanie do Stripe Checkout
  return c.redirect('/api/billing/checkout?plan=basic')
})

pages.get('/success', (c) => {
  return c.render(
    <Layout title="Payment Successful - AudioVault">
      <div class="min-h-screen flex items-center justify-center">
        <div class="text-center">
          <h1 class="text-4xl font-bold text-green-600 mb-4">🎉 Welcome to AudioVault!</h1>
          <p class="text-xl mb-8">Your payment was successful. You can now use your license key in Obsidian.</p>
          <a href="obsidian://show-plugin?id=audiovault" class="bg-blue-600 text-white px-6 py-3 rounded-lg">
            Open Obsidian
          </a>
        </div>
      </div>
    </Layout>
  )
})

pages.get('/cancel', (c) => {
  return c.render(
    <Layout title="Payment Cancelled - AudioVault">
      <div class="min-h-screen flex items-center justify-center">
        <div class="text-center">
          <h1 class="text-4xl font-bold text-gray-600 mb-4">Payment Cancelled</h1>
          <p class="text-xl mb-8">No worries! You can try again anytime.</p>
          <a href="/pricing" class="bg-blue-600 text-white px-6 py-3 rounded-lg">
            Back to Pricing
          </a>
        </div>
      </div>
    </Layout>
  )
})

export default pages
