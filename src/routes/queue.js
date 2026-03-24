const { Router } = require('express');
const queueController = require('../controllers/queueController');

const router = Router();

router.get('/', queueController.getQueue);
router.post('/retry', queueController.retryFailed);
router.delete('/purge', queueController.purgeDone);

module.exports = router;
