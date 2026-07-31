CREATE OR REPLACE PACKAGE BODY emp_pkg IS

  PROCEDURE add_employee(
    p_emp_id   IN NUMBER,
    p_emp_name IN VARCHAR2,
    p_salary   IN NUMBER
  ) IS
  BEGIN
    INSERT INTO employees (employee_id, employee_name, salary)
    VALUES (p_emp_id, p_emp_name, p_salary);

    DBMS_OUTPUT.PUT_LINE('Successfully added employee: ' || p_emp_name);
  EXCEPTION
    WHEN OTHERS THEN
      DBMS_OUTPUT.PUT_LINE('Error adding employee: ' || SQLERRM);
      RAISE;
  END add_employee;

  FUNCTION get_employee_salary(
    p_emp_id IN NUMBER
  ) RETURN NUMBER IS
    v_salary NUMBER := 0;
  BEGIN
    SELECT salary INTO v_salary
    FROM employees
    WHERE employee_id = p_emp_id;

    dbms_output.put_line('Retrieved salary for employee ID ' || p_emp_id || ': ' || v_salary);

    RETURN v_salary;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      RETURN 0;
  END get_employee_salary;

  PROCEDURE print_employee_info(
    p_emp_id IN NUMBER
  ) IS
    v_salary NUMBER;
  BEGIN
    v_salary := get_employee_salary(p_emp_id);
    DBMS_OUTPUT.PUT_LINE('Employee ID ' || p_emp_id || ' Salary is: ' || v_salary);
  END print_employee_info;

END emp_pkg;

