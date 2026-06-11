const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const pool = new Pool();

(async () => {
  const hash = await bcrypt.hash('admin123', 10);
  console.log('New hash:', hash);
  
  try {
    // First delete old user
    await pool.query('DELETE FROM auth_schema.users WHERE email = $1', ['admin@example.com']);
    
    // Insert new user with the fresh hash
    const result = await pool.query(
      `INSERT INTO auth_schema.users (username, email, password_hash, role, department, is_active) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ['admin', 'admin@example.com', hash, 'admin', 'IT', true]
    );
    
    console.log('User created successfully');
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    pool.end();
  }
})();

