const ee = require('@google/earthengine');
console.log("batch exists?", !!ee.batch);
if (ee.batch) {
   console.log("Export exists?", !!ee.batch.Export);
   if (ee.batch.Export) {
       console.log("image exists?", !!ee.batch.Export.image);
   }
}
