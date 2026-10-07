# ADR 0013 — Extraer y comprimir

- Estado: aceptado
- Fecha: 2026-10-07
- Versión: v1.11.0

## Contexto

Se pide poder extraer un archivo comprimido con clic derecho, eligiendo cómo y
dónde, y comprimir en ZIP uno o varios ficheros. Ha de servir en los dos paneles
y en FTP, FTPS y SFTP.

## Decisión

- **Formatos**: se extraen `.zip`, `.tar`, `.tar.gz`/`.tgz` y `.gz`, y solo se
  crea `.zip`. Para ZIP se usan `yauzl` y `yazl` (MIT, JS puro, en el bundle del
  motor). El lector de tar es propio (ustar, GNU y pax, unas 200 líneas) para no
  arrastrar dependencias. 7z queda fuera porque exige empaquetar el binario por
  plataforma, y RAR porque la licencia de unRAR no es compatible con GPL.
- **Todo en el motor** (`transfer/src/archive/`), fuera del hilo de main. main
  solo pone una carpeta temporal (`createTempDir('archive')`), la borra al
  terminar y manda el avance (`state:archive-progress`) a la ventana que lo
  pidió. Cada operación se puede cancelar.
- **En el servidor, si se puede**: con origen y destino en el mismo servidor
  SFTP, se pregunta por `exec` si están `unzip`, `tar`, `gzip` o `zip`
  (`command -v`). Si están, se hace allí mismo sin bajar nada. Las rutas van
  como argumentos de `sh -c`, igual que en el ADR 0012.
- **Si no se puede** (FTP, servidor sin shell como Plesk o cPanel con solo SFTP,
  o falta la herramienta): se baja a la carpeta temporal, se procesa en local y
  se sube el resultado por una conexión de transferencia. Lo mismo vale al
  cruzar de lado: de un ZIP del servidor a una carpeta local, y al revés.
- **Seguridad al extraer**: ninguna entrada puede salir de la carpeta de destino
  (zip-slip). Los enlaces simbólicos, los duros y los dispositivos se saltan y
  cuentan como omitidos. En Windows se retocan los nombres que el sistema no deja
  crear. Los ZIP cifrados se rechazan con un mensaje claro.
- **Conflictos**: «dejar el que hay» (por defecto) o «sobrescribir». Comprimir
  nunca pisa un ZIP existente; se escribe en un `.part` y se renombra al final.
- **Interfaz**: submenús «Extraer» (aquí, en «nombre/» y «Extraer en…») y
  «Comprimir» (en «nombre.zip» y «Comprimir en ZIP…»). Los diálogos permiten
  elegir la carpeta del otro panel. El avance aparece en una tira sobre las
  pestañas del panel inferior, con botón de cancelar.

## Consecuencias

- Por SSH no se sabe cuántos ficheros se han escrito: el aviso dice «extraído
  en el servidor» sin cifras, y el avance no tiene porcentaje.
- Cancelar una orden del servidor cierra el canal, pero el proceso puede acabar
  igualmente en el servidor.
- Los ZIP de `Compress-Archive` de PowerShell 5 guardan las rutas con `\`. En
  local se interpretan como separador; el `unzip` del servidor las deja tal
  cual en el nombre.
- Sin `zip` en el servidor (frecuente), comprimir allí implica bajar y subir.
