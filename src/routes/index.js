const { Router } = require('express');
const syncRoutes = require('./sync');
const statusRoutes = require('./status');
const queueRoutes = require('./queue');
const alertRoutes = require('./alerts');

const router = Router();

router.use('/sync', syncRoutes);
router.use('/status', statusRoutes);
router.use('/queue', queueRoutes);
router.use('/alerts', alertRoutes);

module.exports = router;
