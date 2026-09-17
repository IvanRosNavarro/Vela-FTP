import { describe, expect, it } from 'vitest';
import { decodeServerPath, parseSiteManager } from './filezilla';

const XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<FileZilla3 version="3.67.0" platform="windows">
  <Servers>
    <Server>
      <Host>ftp.raiz.com</Host>
      <Port>21</Port>
      <Protocol>4</Protocol>
      <Type>0</Type>
      <User>raiz</User>
      <Pass encoding="base64">Y2xhdmUgw7E=</Pass>
      <Logontype>1</Logontype>
      <Name>Sitio raíz</Name>
      <Comments>Producción</Comments>
      <LocalDir>C:\\web</LocalDir>
      <RemoteDir>1 0 3 var 3 www</RemoteDir>
    </Server>
    <Folder expanded="1">Clientes
      <Server>
        <Host>sftp.cliente.com</Host>
        <Port>2222</Port>
        <Protocol>1</Protocol>
        <Logontype>5</Logontype>
        <User>deploy</User>
        <Keyfile>C:\\keys\\cliente.ppk</Keyfile>
        <Name>Cliente A</Name>
      </Server>
      <Folder expanded="0">Antiguos
        <Server>
          <Host>viejo.com</Host>
          <Protocol>0</Protocol>
          <Logontype>1</Logontype>
          <User>u</User>
          <Pass encoding="crypt">cifrado-con-maestra</Pass>
          <Name>Viejo</Name>
        </Server>
        <Server>
          <Host>bucket.s3.amazonaws.com</Host>
          <Protocol>7</Protocol>
          <Name>S3</Name>
        </Server>
      </Folder>
    </Folder>
    <Server>
      <Host>anon.org</Host>
      <Protocol>3</Protocol>
      <Logontype>0</Logontype>
      <Name>Anónimo</Name>
    </Server>
  </Servers>
</FileZilla3>`;

describe('importar FileZilla', () => {
  it('decodifica rutas serializadas', () => {
    expect(decodeServerPath('1 0 3 var 3 www')).toBe('/var/www');
    expect(decodeServerPath('1 0 9 mis cosas 4 2024')).toBe('/mis cosas/2024');
    expect(decodeServerPath('1 0')).toBe('/');
    expect(decodeServerPath('')).toBeNull();
    expect(decodeServerPath('1 0 99 corto')).toBeNull();
  });

  it('convierte sitios, carpetas, contraseñas y avisos', () => {
    const { servers, skipped } = parseSiteManager(XML);
    const byName = Object.fromEntries(servers.map((s) => [s.site.name, s]));

    expect(byName['Sitio raíz']).toMatchObject({
      password: 'clave ñ',
      site: {
        protocol: 'ftps',
        host: 'ftp.raiz.com',
        username: 'raiz',
        auth: 'password',
        projectName: null,
        remotePath: '/var/www',
        localPath: 'C:\\web',
        notes: 'Producción',
        hasPassword: true,
      },
    });
    expect(byName['Cliente A']?.site).toMatchObject({
      protocol: 'sftp',
      port: 2222,
      auth: 'key',
      keyPath: 'C:\\keys\\cliente.ppk',
      projectName: 'Clientes',
    });
    expect(byName['Viejo']).toMatchObject({ password: null, site: { projectName: 'Clientes / Antiguos', hasPassword: false, protocol: 'ftp' } });
    expect(byName['Viejo']?.site.warnings.some((w) => w.includes('contraseña maestra'))).toBe(true);
    expect(byName['Anónimo']?.site).toMatchObject({ protocol: 'ftps-implicit', port: 990, auth: 'anonymous', username: '' });
    expect(skipped).toEqual([{ name: 'S3', reason: 'Protocolo no soportado (S3, WebDAV u otro)' }]);
  });

  it('un fichero sin servidores no falla', () => {
    expect(parseSiteManager('<FileZilla3><Servers/></FileZilla3>')).toEqual({ servers: [], skipped: [] });
    expect(parseSiteManager('<otra-cosa/>')).toEqual({ servers: [], skipped: [] });
  });
});
