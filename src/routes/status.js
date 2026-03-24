const { Router } = require('express');
const statusController = require('../controllers/statusController');

const router = Router();

router.get('/', statusController.getStatus);
router.get('/connections', statusController.getConnections);
router.get('/queue', statusController.getQueueStatus);

module.exports = router;
