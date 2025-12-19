

//==========================
// 1. Cargar datos de Piura
//==========================
var peru = ee.FeatureCollection("projects/sat-io/open-datasets/FAO/GAUL/GAUL_2024_L1");

var piura = peru.filter(ee.Filter.eq('gaul1_name', 'Piura'));
var geometry = piura.geometry();
Map.centerObject(geometry, 7);
Map.addLayer(piura, {color: 'red'}, 'Piura 2024');
//Obtener limites de geometría
// Obtener los límites de la geometría(VERIFICACION CORDENADAS)
var bounds = geometry.bounds();
print('Límites de Piura (bounds):', bounds);

// Obtener las coordenadas del rectángulo que encierra a Piura
var coords = bounds.coordinates();
print('Coordenadas del rectángulo (bounds.coordinates):', coords);

// Obtener coordenadas mínimas y máximas (bbox numérica)
var info = geometry.bounds().coordinates().get(0);
var ll = ee.List(info).get(0); // esquina inferior izquierda
var ur = ee.List(info).get(2); // esquina superior derecha

print('Esquina inferior izquierda (SO):', ll);
print('Esquina superior derecha (NE):', ur);


//==========================
// 2. Colección Sentinel-2 Nuevo código //antesde la seuqia
//==========================
var startDate = ee.Date('2024-07-01');
var endDate = ee.Date('2024-09-30');

//NDVI antes de la sequía 
var ndviBefore = ee.ImageCollection('COPERNICUS/S2')
  .filterDate(startDate, endDate)//filtrando entrtre estas fechas 
  .filterBounds(geometry)
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
  .map(function(img){
    var ndvi = img.normalizedDifference(['B8','B4']).rename('NDVI');
    return ndvi.copyProperties(img, img.propertyNames());
  });
  

  
//==========================
// 3. Calcular NDVI promedio y enmascarar cultivos
//==========================
var ndvi = ndviBefore.mean();//Promedio de NDVI entre Enero y Marzo 
var landcover = ee.Image("ESA/WorldCover/v200/2021").clip(geometry);
var cultivos = landcover.eq(40);  // solo áreas agrícolas las imagenes con carretes las aleja
var ndviCultivos = ndvi.updateMask(cultivos);//actualiza para que solo se enfoque en imagenes que tenga cultivos

//NDVI druante la sequia
var ndviAfter = ee.ImageCollection('COPERNICUS/S2')
  //.filterDate('2024-11-01', '2024-12-31')
  .filterDate('2024-10-01', '2024-12-31')
  .filterBounds(geometry)
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
  .map(function(img){ return img.normalizedDifference(['B8','B4']).rename('NDVI'); })
  .mean()
  .updateMask(cultivos);
//----  //CODIGO NUEVO ---------------------
// Calcular NDVI promedio antes de la sequía



var minMaxBefore = ndviCultivos.reduceRegion({
  reducer: ee.Reducer.min().combine({
    reducer2: ee.Reducer.max(),
    sharedInputs: true
  }),
  geometry: geometry,
  scale: 10,
  maxPixels: 1e9
});

print("NDVI BEFORE - Min y Max (solo cultivos):", minMaxBefore);






var statsAfter = ndviAfter.reduceRegion({
  reducer: ee.Reducer.minMax(),
  geometry: geometry,
  scale: 10,
  maxPixels: 1e13
});
print('NDVI After min/max:', statsAfter);




//----No tocar---------



var ndviChange = ndviAfter.subtract(ndviBefore.mean()).rename('NDVI_Change');
//Hallando percentil 50 
var percentiles = ndviChange.reduceRegion({
  reducer: ee.Reducer.percentile([50]),
  geometry: geometry,
  scale: 10,
  maxPixels: 1e13
});

print("Percentil 50 de la anomalía NDVI:", percentiles);





// Parcelas resilientes: NDVI no cayó más de 0.01948
var resilient = ndviChange.gte(0.01948).updateMask(cultivos);//Percentil 
Map.addLayer(resilient, {palette:['#00FF00']}, 'Parcelas resilientes (post-sequía)');


//-----------------------------------Codigo Nuevo Hectareas parselas resilientes
//Indentificar hectareas resilientes 
var pixelArea=ee.Image.pixelArea();//área en m2 por pixel 

//mmultiplicar el área del pixel por la mascara de parcelas resilientes
var areaResiliente=pixelArea.updateMask(resilient);

//Sumar todad las áreas demtrp del area de cultivos 
var totalArea = areaResiliente.reduceRegion({
  reducer: ee.Reducer.sum(),
  geometry: cultivos.geometry(),
  scale: 10,
  maxPixels: 1e13
});

// 5. Convertir m2 a hectáreas
var hectareas = ee.Number(totalArea.get('area')).divide(10000);

print("Hectáreas resilientes:", hectareas);

//==========================
// 4. Clasificar parcelas --Percentiles
//==========================

//var healthy = ndviCultivos.gte(0.5);
var healthy = ndviCultivos.gte(0.360268);//percentil75
var dryAreas = ndviCultivos.lt(0.251616);
var safeAreas = healthy.updateMask(healthy);//healthy es una imaagen binaria todos los cultivos saludables
//Codigo nuievo 
// 1. Área por píxel (m²)
var pixelArea = ee.Image.pixelArea();

// 2. Multiplicar área por máscara de estrés hídrico
var areaStress = pixelArea.updateMask(dryAreas);

// 3. Sumar áreas dentro de cultivos
var totalAreaStress = areaStress.reduceRegion({
  reducer: ee.Reducer.sum(),
  geometry: cultivos.geometry(),
  scale: 10,
  maxPixels: 1e13
});

// 4. m² → hectáreas
var hectareasStress = ee.Number(totalAreaStress.get('area')).divide(10000);
print("Hectáreas con estrés hídrico:", hectareasStress);

// 5. hectáreas → km²
var km2Stress = hectareasStress.divide(100);
print("Kilómetros cuadrados con estrés hídrico:", km2Stress);


//==========================
// 5. NDVI histórico y anomalía
//==========================
var s2_hist = ee.ImageCollection('COPERNICUS/S2')//NDVI del 2018 al 2023
  .filterDate('2018-07-01','2023-09-30')//ANALIZAR ESTOOO 
  .filterBounds(geometry)//Piura
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
  .map(function(img){ return img.normalizedDifference(['B8','B4']).rename('NDVI'); })
  .mean();

var anomaly = ndviCultivos.subtract(s2_hist.updateMask(cultivos)).rename('NDVI_Anomaly');//Resta el NDVI ACTUAL -NDVI Historico
//var droughtAreas = anomaly.lt(-0.2);(Principal)//imagen binarias solo muestra los que tenga valor 1 , es 
var droughtAreas = anomaly.lt(-0.03505).unmask(0).rename('drought');                                      //decir si todas las imagenes que su NDVIse menor al al promedio que es -0.2 es sequia
                               //percentil historico
//s2_hist.updateMask(cultivos)  solo se haga la comparación en zonas agricolass 

//-------------------------------------------------------------------------------------------------------------------------------------------------------------------
//--------------------------------------------------CODIGO PARA LOS PERCENTILES PONERLO EN OTRA PÁGINA( PONERLO EN OTRA PAGINA PARA EN GOOGLE EARTH ENGINE PARA
//                                                  EVITAR EL ERROR DE TIEMPO EXCEDIDO EN PROCESAMIENTO --------------------------------------------------
//-------------------------------------------------------------------------------------------------------------------------------------------
/*
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

// Lista de valores NDVI para percentiles
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
var normal    = ndviAfterMasked.gte(p25_hist).and(ndviAfterMasked.lt(p75_hist));
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

//-------------------------------------------------------------------------------------------------------------
//-----------------------------------------------------------------------------------------------------------

*/

//==========================
// 6. Visualización
//==========================
Map.addLayer(ndvi.clip(geometry), {min:0, max:1, palette:['red','yellow','green']}, 'NDVI (seco → saludable)');
Map.addLayer(safeAreas, {palette:['green']}, 'Parcelas saludables');
Map.addLayer(dryAreas.updateMask(dryAreas), {palette:['red']}, 'Zonas con estrés hídrico');
Map.addLayer(anomaly.clip(geometry), {min:-0.5, max:0.5, palette:['red','white','green']}, 'Anomalía NDVI 2024 vs histórico');
Map.addLayer(droughtAreas.updateMask(droughtAreas), {palette:['orange']}, 'Zonas con sequía (anomalía)');

//==========================
// 7. Recomendación AlphaEarth
//==========================
var ae = ee.ImageCollection("GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL")//Importo 
  .filterDate('2024-01-01', '2024-12-31')//entre la fecha 
  .map(function(img){ return img.clip(geometry); });

var aeMean = ae.mean();
var aeHealthy = aeMean.updateMask(healthy);//Me quedo con pixeles que mi codigo dice que son saludables

// Obtener promedio de zonas saludables

var healthySample = aeHealthy.reduceRegion({
  reducer: ee.Reducer.mean(),
  geometry: geometry,
  scale: 100,
  maxPixels: 1e13,
  bestEffort: true
});
print('Valores promedio zonas saludables (healthySample):', healthySample);

//Nuvo código 
var sampleValues = ee.Dictionary(healthySample);
var keys = aeMean.bandNames();
var sampleArray = keys.map(function(k){
  return ee.Number(sampleValues.get(k, 0)); // si falta, pone 0
});

sampleArray = ee.List(sampleArray);//nuevo

//var healthySampleImg = ee.Image.constant(healthySample.values(healthySample.keys()))
                         //   .rename(aeMean.bandNames());PRINCIPAL
                         
var healthySampleImg = ee.Image.constant(sampleArray).rename(keys);
// Distancia euclidiana normalizada para recomendar parcelas
var dist = aeMean.subtract(healthySampleImg).pow(2).reduce(ee.Reducer.sum()).sqrt().rename('distancia');//Cambie esto
var minMax = dist.reduceRegion({reducer: ee.Reducer.minMax(), geometry: geometry, scale: 100, maxPixels: 1e13});
var distNorm = dist.subtract(ee.Number(minMax.get('distancia_min')))
                   .divide(ee.Number(minMax.get('distancia_max')).subtract(ee.Number(minMax.get('distancia_min'))));
//Codigo recomendado***Nuevo
var scale = 100; // o la escala que estés usando
var droughtAligned = droughtAreas.reproject({crs: aeMean.projection(), scale: scale});
var cultivosAligned = cultivos.reproject({crs: aeMean.projection(), scale: scale});
//------------------------------
//var recommended = distNorm.lt(0.1).updateMask(cultivos).updateMask(droughtAreas.not());principal
//Map.addLayer(recommended, {palette:['yellow']}, 'Parcelas recomendadas');//principal
var recommended = distNorm.lt(0.1)
  .updateMask(cultivosAligned)
  .updateMask(resilient)
  .updateMask(droughtAligned.eq(0));
  Map.addLayer(recommended, {palette:['yellow']}, 'Parcelas recomendadas');
//==========================
// 8. Exportar imágenes  
//==========================
Export.image.toDrive({image: aeHealthy, description:'AlphaEarth_Saludables', folder:'EarthEngine', fileNamePrefix:'AE_Saludables_Piura', scale:100, region:geometry, maxPixels:1e13});
Export.image.toDrive({image: anomaly, description:'NDVI_Anomalia_Piura', folder:'EarthEngine', fileNamePrefix:'NDVI_Anomalia_Piura', scale:100, region:geometry, maxPixels:1e13});
Export.image.toDrive({image: recommended, description:'Parcelas_AlphaEarth_Similares_Saludables', folder:'EarthEngine', fileNamePrefix:'Parcelas_Similares_Piura', scale:100, region:geometry, maxPixels:1e13});



