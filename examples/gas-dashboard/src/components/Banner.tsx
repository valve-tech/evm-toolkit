export const Banner = ({ message }: { message: string }): JSX.Element => (
  <div className="banner error" role="alert">
    {message}
  </div>
)
