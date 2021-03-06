import React from 'react';
import PropTypes from 'prop-types';
import Helmet from 'react-helmet';
import { StaticQuery, graphql } from 'gatsby';
import { Container } from 'semantic-ui-react';

import Header from '../components/header';
import Footer from '../components/footer';

import '../css/styles.css';
import 'semantic-ui-css/semantic.min.css';

export default class DefaultLayout extends React.PureComponent {
	render() {
		const { children } = this.props;

		return (
			<StaticQuery
				query={graphql`
					query SiteTitleQuery {
						site {
							siteMetadata {
								title
							}
						}
					}
				`}

				render={data => (
					<>
						<Helmet
							title={data.site.siteMetadata.title}
							meta={[
								{ name: 'description', content: 'cli-kit: Node.js Command Line Interface Toolkit' },
								{ name: 'keywords', content: 'node, cli, command line, climl, parser, prompting' }
							]}
						>
							<html lang="en" />
						</Helmet>
						<Header />
						<main>
							<Container>
								{children}
							</Container>
						</main>
						<Footer />
					</>
				)}
			/>
		);
	}
}

DefaultLayout.propTypes = {
	children: PropTypes.node.isRequired
};
