const { Router } = require('express');
const alertController = require('../controllers/alertController');

const router = Router();

router.get('/', alertController.getActive);
router.get('/history', alertController.getHistory);
router.post('/:id/acknowledge', alertController.acknowledge);

module.exports = router;
