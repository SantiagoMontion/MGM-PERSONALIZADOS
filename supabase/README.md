# Supabase setup

## Buckets

- Crear un bucket **privado** llamado `uploads` para recibir los archivos originales.
- Crear un bucket **público** llamado `outputs` donde se guardarán los JPG/PDF de salida y las previews.
- Asegurarse de que las políticas RLS permitan acceso con la clave de servicio (service role).

## Esquema

El archivo [`schema.sql`](./schema.sql) contiene la definición de las tablas `jobs` y `job_events`.
Ejecuta ese SQL en tu proyecto de Supabase para crear las tablas e índices necesarios.
