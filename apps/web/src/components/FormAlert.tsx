type FormAlertProps = {
  message: string;
};

export function FormAlert({ message }: FormAlertProps) {
  return (
    <div className="form-alert form-alert--error" role="alert">
      {message}
    </div>
  );
}
