import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { defaultLimiter } from './middleware/rateLimiter'
import { errorHandler } from './middleware/errorHandler'
import { notFound } from './middleware/notFound'
import authRouter from './routes/auth'
import adminRouter from './routes/admin'
import steamRouter from './routes/steam'
import inventoryRouter from './routes/inventory'
import tradersRouter from './routes/traders'
import conversationsRouter from './routes/conversations'
import proposalsRouter from './routes/proposals'
import userReportsRouter from './routes/userReports'
import offersRouter from './routes/offers'
import marketPricesRouter from './routes/marketPrices'
import inventoryByUserRouter from './routes/inventoryByUser'

const app = express()
const PORT = process.env.PORT ?? 4000

const allowedOrigins = process.env.NODE_ENV === 'production'
  ? [process.env.CLIENT_URL ?? 'http://localhost:5173']
  : /^http:\/\/localhost:\d+$/

app.use(cors({ origin: allowedOrigins, credentials: true }))
app.use(express.json())

// Steam routes are browser redirects — must be registered before the rate limiter
app.use('/api/auth', steamRouter)

app.use(defaultLimiter)

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

app.use('/api/auth', authRouter)
app.use('/api/me', inventoryRouter)
app.use('/api/inventory', inventoryByUserRouter)
app.use('/api/traders', tradersRouter)
app.use('/api/conversations', conversationsRouter)
app.use('/api/proposals', proposalsRouter)
app.use('/api/reports', userReportsRouter)
app.use('/api/offers', offersRouter)
app.use('/api/market', marketPricesRouter)
app.use('/api/admin', adminRouter)

app.use(notFound)
app.use(errorHandler)

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

export default app
