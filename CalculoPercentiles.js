//======================================================
// 1. Cargar datos de Piura
//======================================================
var peru = ee.FeatureCollection("projects/sat-io/open-datasets/FAO/GAUL/GAUL_2024_L1");
var piura = peru.filter(ee.Filter.eq('gaul1_name', 'Piura'));
var geometry = piura.geometry();
Map.centerObject(piura, 7);


//======================================================
// 2. NDVI ANTES y DESPUÉS de la sequía
//======================================================
function getNDVI(start, end) {
  return ee.ImageCollection('COPERNICUS/S2')
    .filterDate(start, end)
    .filterBounds(geometry)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
    .map(function(img){ 
      return img.normalizedDifference(['B8','B4']).rename('NDVI'); 
    })
    .mean();
}

var ndviBefore = getNDVI('2024-07-01', '2024-09-30');
var ndviAfter  = getNDVI('2024-10-01', '2024-12-31');


//======================================================
// 3. Máscara de cultivos
//======================================================
var landcover = ee.Image("ESA/WorldCover/v200/2021").clip(geometry);
var cultivos = landcover.eq(40);

var ndviBeforeMasked = ndviBefore.updateMask(cultivos);
var ndviAfterMasked  = ndviAfter.updateMask(cultivos);


//======================================================
// 4. Cambio NDVI
//======================================================
var ndviChange = ndviAfterMasked.subtract(ndviBeforeMasked).rename('NDVI_Change');


//======================================================
// 5. NDVI histórico (2018–2023) + percentiles acelerados
//======================================================
var s2_hist = ee.ImageCollection('COPERNICUS/S2')
  .filterDate('2018-07-01','2023-09-30')
  .filterBounds(geometry)
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
  .map(function(img){ 
    return img.normalizedDifference(['B8','B4']).rename('NDVI'); 
  })
  .mean()
  .updateMask(cultivos);

// Tomar muestra pequeña → rápido
var sample = s2_hist.sample({
  region: geometry,
  scale: 20,
  numPixels: 5000,
  seed: 42,
  geometries: false
});
// (Importante IIMPORTANTE)
//PASOS en RecomendaciónParcelas esta todo el código terminado corre el código 
//Ahora Si se quiere validar de donde saque el valor de los percentiles correr CalcularPercentiles.js (CALUVLAR PERCENTIL POR PERCENTILES LOS DEMAS COMENTARLOS )
// 
var sampleList = sample.aggregate_array('NDVI');

// Percentiles
var p10_hist = ee.Number(sampleList.reduce(ee.Reducer.percentile([10])));
var p25_hist = ee.Number(sampleList.reduce(ee.Reducer.percentile([25])));
var p75_hist = ee.Number(sampleList.reduce(ee.Reducer.percentile([75])));

print("P10 histórico (estrés severo):", p10_hist);
print("P25 histórico (estrés leve):", p25_hist);
print("P75 histórico (vegetación saludable):", p75_hist);


//======================================================
// 6. Clasificación FAO usando NDVI After
//======================================================
var healthy   = ndviAfterMasked.gte(p75_hist);
//var normal    = ndviAfterMasked.gte(p25_hist).and(ndviAfterMasked.lt(p75_hist));
var dry       = ndviAfterMasked.lt(p25_hist);
var severeDry = ndviAfterMasked.lt(p10_hist);


//======================================================
// 7. Visualización
//======================================================
Map.addLayer(ndviBeforeMasked, {min:0, max:1, palette:['red','yellow','green']}, 'NDVI antes');
Map.addLayer(ndviAfterMasked,  {min:0, max:1, palette:['red','yellow','green']}, 'NDVI después');

Map.addLayer(healthy,   {palette:['#00FF00']}, 'Saludable (≥ P75)');
Map.addLayer(normal,    {palette:['#A4DE02']}, 'Normal (P25-P75)');
Map.addLayer(dry,       {palette:['#FF0000']}, 'Estrés hídrico (<P25)');
Map.addLayer(severeDry, {palette:['#FFA500']}, 'Estrés severo (<P10)');

Map.addLayer(ndviChange, {min:-0.5, max:0.5, palette:['blue','white','red']}, 'NDVI Change');
