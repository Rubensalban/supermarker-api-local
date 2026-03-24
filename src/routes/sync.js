const { Router } = require('express');
const syncController = require('../controllers/syncController');

const router = Router();

router.post('/clients', (req, res, next) => {
  req.params.entity = 'client';
  syncController.syncEntity(req, res, next);
});

router.post('/articles', (req, res, next) => {
  req.params.entity = 'article';
  syncController.syncEntity(req, res, next);
});

router.post('/factures', (req, res, next) => {
  req.params.entity = 'facture';
  syncController.syncEntity(req, res, next);
});

router.post('/reglements', (req, res, next) => {
  req.params.entity = 'reglement';
  syncController.syncEntity(req, res, next);
});

router.post('/all', syncController.syncAll);
router.post('/full', syncController.syncFull);
router.post('/pause', syncController.pause);
router.post('/resume', syncController.resume);
router.get('/logs', syncController.getLogs);

module.exports = router;
