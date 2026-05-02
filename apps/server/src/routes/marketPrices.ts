import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { getMarketPrice } from '../lib/marketPrice'

const router = Router()
router.use(authenticate)

router.get('/price', async (req, res, next) => {
  try {
    const name = req.query.name
    if (typeof name !== 'string' || name.length === 0 || name.length > 200) {
      res.status(400).json({ error: 'Invalid name' })
      return
    }
    const price = await getMarketPrice(name)
    if (!price) {
      res.status(502).json({ error: 'Price unavailable' })
      return
    }
    res.json(price)
  } catch (err) {
    next(err)
  }
})

export default router
